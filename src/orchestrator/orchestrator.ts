// orchestrator: runs the BRAIN lane end to end for one question.
//   cache lookup -> planner -> DAG
//   per parallel group, one full lane PER sub-question CONCURRENTLY
//     (lane = SQL agent -> insight agent -> dashboard-plan agent)
//   coalesce sub-question plans -> one dashboard spec
//   codeGen -> renderVerifier (-> codeEdit if needed)
//   serve on localhost, return the full lane:"brain" ledger.
// Caps stay intact: every agent enforces its own cheap/retry/escalate/stop loop.
import type { Pool } from "pg";
import { getPool, runReadOnlyQuery } from "../db/index.js";
import { buildContext, type ContextProvider, type ResultRow } from "../context/index.js";
import {
  runPlanner,
  runSqlAgent,
  adaptCachedSql,
  runInsightAgent,
  runDashboardPlanAgent,
  runCodeGenAgent,
  runCodeEditAgent,
  type Plan,
  type PlanNode,
} from "../agents/index.js";
import { cacheLookup, cacheStore } from "../cache/index.js";
import {
  getLedger,
  getTotals,
  resetLedger,
  type LedgerEntry,
  type Totals,
} from "../models/index.js";
import { buildDashboardHtml, serveDashboard, type DashboardServer } from "../web/dashboardHost.js";

export interface LaneResult {
  id: string;
  question: string;
  ok: boolean;
  /**
   * Where the SQL came from:
   *  - "cache": a near-exact hit, reused verbatim (one embedding, ~$0, no SQL gen)
   *  - "cache-adapted": a near match adapted with a single cheap model call
   *  - "generated": full SQL agent (generate → retry → escalate)
   */
  sqlSource?: "cache" | "cache-adapted" | "generated";
  /** Cosine similarity of the cache hit that produced the SQL, if any. */
  cacheSimilarity?: number;
  sql?: string;
  rows?: ResultRow[];
  insight?: string;
  plan?: unknown;
  /** Which stage failed, if any. */
  failedStage?: "sql" | "dashboard";
  failure?: string;
  startedAt: number;
  finishedAt: number;
}

export interface DashboardChart {
  id: string;
  question: string;
  plan: unknown;
  data: ResultRow[];
  insight?: string;
}

export interface DashboardSpec {
  title: string;
  charts: DashboardChart[];
}

/** Per-chart shape handed to codeGen AND injected as the `data` prop (see designBrief). */
export interface DashboardViewChart {
  id: string;
  question: string;
  plan: unknown;
  rows: ResultRow[];
  insight?: string;
}

/** The exact object the rendered component receives as its `data` prop. */
export interface DashboardView {
  title: string;
  charts: DashboardViewChart[];
}

/** Translate the internal spec (rows under `data`) into the render contract (rows under `rows`). */
function toDashboardView(spec: DashboardSpec): DashboardView {
  return {
    title: spec.title,
    charts: spec.charts.map((c) => ({
      id: c.id,
      question: c.question,
      plan: c.plan,
      rows: c.data,
      ...(c.insight ? { insight: c.insight } : {}),
    })),
  };
}

export interface BrainResult {
  ok: boolean;
  question: string;
  plan: Plan | null;
  lanes: LaneResult[];
  /** Sub-questions whose SQL came from the cache (reused or adapted). */
  cacheHits: number;
  dashboard: {
    spec: DashboardSpec;
    code: string;
    html: string;
    renderOk: boolean;
    codeEditUsed: boolean;
  } | null;
  server: DashboardServer | null;
  ledger: LedgerEntry[];
  totals: Totals;
  reason?: string;
}

export interface BrainOptions {
  /** Scoped-context provider. Defaults to a live introspection (buildContext()). */
  context?: ContextProvider;
  /** DB pool for SQL execution/caching. Defaults to the shared pool. */
  db?: Pool;
  /** Serve the dashboard on localhost. Default true. */
  serve?: boolean;
  /** Port for the localhost server (0 = pick a free port). Default 0. */
  port?: number;
  /** Cache similarity threshold override. */
  cacheThreshold?: number;
  /** Reset the per-run ledger at the start. Default true. */
  freshLedger?: boolean;
}

// A trivial single-node plan: answer the whole question as one "main query".
// Used when the planner fails, or as the last-resort fallback when no decomposed
// sub-question produced a usable chart.
function mainQueryPlan(question: string): Plan {
  return { subQuestions: [{ id: "main", question, dependsOn: [] }], groups: [["main"]] };
}

// At or above this cosine similarity a cache hit is treated as the SAME question
// and the cached SQL is reused verbatim (no model call). Below it (down to the
// lookup threshold) the cached SQL is adapted with one cheap call instead.
const EXACT_REUSE_THRESHOLD = 0.93;

interface LaneDeps {
  context: ContextProvider;
  db: Pool;
  cacheThreshold?: number;
}

/**
 * One full lane for a single sub-question: SQL (cache-first) -> insight -> plan.
 *
 * IMPORTANT: Dependencies in the DAG enforce temporal ordering only, not data flow.
 * Each lane runs independently against the schema; dependent sub-questions do NOT
 * receive their dependency's result data as context. This design prioritizes
 * parallelism and simplicity over multi-step data threading. See README for details.
 */
async function runLane(node: PlanNode, deps: LaneDeps): Promise<LaneResult> {
  const startedAt = Date.now();
  const base = { id: node.id, question: node.question, startedAt };

  let sql: string | undefined;
  let rows: ResultRow[] | undefined;
  let sqlSource: "cache" | "cache-adapted" | "generated" | undefined;
  let cacheSimilarity: number | undefined;

  // SQL step, cache-first. On a cache hit we either:
  //  - reuse the cached SQL verbatim when the match is near-exact (one embedding,
  //    ~$0, no SQL generation at all), or
  //  - adapt it to this sub-question with a SINGLE cheap model call (skeleton
  //    reuse) when it's a looser paraphrase.
  // Either way the SQL is executed/verified and must return rows; otherwise we
  // fall back to full generation below.
  const lookup = await cacheLookup(node.question, {
    pool: deps.db,
    ...(deps.cacheThreshold !== undefined ? { threshold: deps.cacheThreshold } : {}),
  });
  if (lookup.hit) {
    cacheSimilarity = lookup.similarity;
    if (lookup.similarity >= EXACT_REUSE_THRESHOLD) {
      try {
        const r = await runReadOnlyQuery(lookup.sql, deps.db);
        if (r.rows.length > 0) {
          sql = lookup.sql;
          rows = r.rows;
          sqlSource = "cache";
        }
      } catch {
        // Cached SQL no longer valid (e.g. schema changed) — regenerate below.
      }
    } else {
      // Looser match: adapt the cached skeleton with one cheap call.
      const adapted = await adaptCachedSql(node.question, lookup.cachedQuestion, lookup.sql, {
        db: deps.db,
      });
      if (adapted.ok && adapted.sql && adapted.rows && adapted.rows.length > 0) {
        sql = adapted.sql;
        rows = adapted.rows;
        sqlSource = "cache-adapted";
      }
    }
  }

  if (!sql || !rows) {
    const sqlRes = await runSqlAgent(node.question, { context: deps.context, db: deps.db });
    if (!sqlRes.ok) {
      return { ...base, ok: false, failedStage: "sql", failure: sqlRes.reason, finishedAt: Date.now() };
    }
    sql = sqlRes.data.sql;
    rows = sqlRes.data.rows;
    sqlSource = "generated";
    // Step 3: write a successful, non-cached (question, embedding, SQL) to cache.
    try {
      await cacheStore(node.question, sql, { pool: deps.db });
    } catch {
      // Caching is best-effort; a write failure must not fail the lane.
    }
  }

  // Insight step (supplementary — a verified failure does not sink the lane).
  const insightRes = await runInsightAgent(rows, { context: deps.context });
  const insight = insightRes.ok ? insightRes.data.text : undefined;

  // Dashboard-plan step. We already have verified rows, so a failed chart spec
  // must NOT sink the lane — fall back to a minimal plan (just a title) and let
  // the renderer auto-detect x/y/type (and KPI for a single value) from the rows.
  const planRes = await runDashboardPlanAgent(rows, { context: deps.context });
  const plan: unknown = planRes.ok ? planRes.data.plan : { title: node.question };

  return {
    ...base,
    ok: true,
    sql,
    rows,
    sqlSource,
    ...(cacheSimilarity !== undefined ? { cacheSimilarity } : {}),
    ...(insight ? { insight } : {}),
    plan,
    finishedAt: Date.now(),
  };
}

export async function runBrainLane(question: string, opts: BrainOptions = {}): Promise<BrainResult> {
  if (opts.freshLedger !== false) resetLedger();

  const db = opts.db ?? getPool();
  const context = opts.context ?? (await buildContext(db));
  const laneDeps: LaneDeps = {
    context,
    db,
    ...(opts.cacheThreshold !== undefined ? { cacheThreshold: opts.cacheThreshold } : {}),
  };

  const finish = (extra: Partial<BrainResult>): BrainResult => ({
    ok: false,
    question,
    plan: null,
    lanes: [],
    cacheHits: 0,
    dashboard: null,
    server: null,
    ledger: getLedger(),
    totals: getTotals(),
    ...extra,
  });

  // 1. Plan the question into a DAG of sub-questions. If planning fails, fall
  //    back to treating the WHOLE question as a single "main query" lane — a
  //    question that can't be decomposed should still be answered directly.
  const planned = await runPlanner(question, { context });
  const plan: Plan = planned.ok ? planned.data : mainQueryPlan(question);
  const byId = new Map(plan.subQuestions.map((n) => [n.id, n]));

  // 2. Run each parallel group concurrently; groups run in DAG order.
  // Note: Dependencies ensure group B starts after group A finishes, but
  // lanes in group B do NOT receive data from lanes in group A. Each lane
  // generates SQL independently from the schema. See README for rationale.
  const lanes: LaneResult[] = [];
  for (const group of plan.groups) {
    const nodes = group.map((id) => byId.get(id)).filter((n): n is PlanNode => Boolean(n));
    const groupResults = await Promise.all(nodes.map((n) => runLane(n, laneDeps)));
    lanes.push(...groupResults);
  }

  // 4. Coalesce successful sub-question plans into ONE dashboard spec.
  const toChart = (l: LaneResult): DashboardChart => ({
    id: l.id,
    question: l.question,
    plan: l.plan,
    data: l.rows ?? [],
    ...(l.insight ? { insight: l.insight } : {}),
  });
  const charts: DashboardChart[] = lanes.filter((l) => l.ok).map(toChart);

  // 4b. Robustness fallback: if NO sub-question produced a usable chart, run the
  //     ORIGINAL question directly as a single main query (unless we already
  //     tried exactly that). Piecewise decomposition can fail while the question's
  //     primary intent is answerable as one query.
  if (charts.length === 0) {
    const alreadyTriedWhole = lanes.some((l) => l.question.trim() === question.trim());
    if (!alreadyTriedWhole) {
      const mainLane = await runLane({ id: "main", question, dependsOn: [] }, laneDeps);
      lanes.push(mainLane);
      if (mainLane.ok) charts.push(toChart(mainLane));
    }
  }

  const spec: DashboardSpec = { title: question, charts };
  const cacheHits = lanes.filter(
    (l) => l.ok && (l.sqlSource === "cache" || l.sqlSource === "cache-adapted"),
  ).length;

  if (charts.length === 0) {
    return finish({ plan, lanes, cacheHits, reason: "no sub-question produced a usable chart" });
  }

  // 5. codeGen the combined dashboard; if it can't render, hand the broken
  //    output to codeEdit (its dedicated job). The render view (rows under
  //    `rows`) is BOTH the codeGen context and the runtime `data` prop, so the
  //    component the model writes binds to exactly the object it is given.
  const view = toDashboardView(spec);
  const codeGen = await runCodeGenAgent(view, [], { context });
  let code: string;
  let renderOk: boolean;
  let codeEditUsed = false;
  if (codeGen.ok) {
    code = codeGen.data.code;
    renderOk = true;
  } else {
    codeEditUsed = true;
    const broken = codeGen.attempts.at(-1)?.rawOutput ?? "";
    const edit = await runCodeEditAgent(broken, codeGen.reason, { context });
    if (edit.ok) {
      code = edit.data.code;
      renderOk = true;
    } else {
      code = edit.attempts.at(-1)?.rawOutput ?? broken;
      renderOk = false;
    }
  }

  // 6. Serve on localhost and return the brain ledger.
  const html = buildDashboardHtml(code, view, `Hive — ${question}`);
  const server = opts.serve === false ? null : await serveDashboard(html, { port: opts.port ?? 0 });

  return {
    ok: renderOk,
    question,
    plan,
    lanes,
    cacheHits,
    dashboard: { spec, code, html, renderOk, codeEditUsed },
    server,
    ledger: getLedger(),
    totals: getTotals(),
  };
}
