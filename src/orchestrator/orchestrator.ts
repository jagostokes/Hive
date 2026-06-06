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
  /** Where the SQL came from: a cache hit or fresh generation. */
  sqlSource?: "cache" | "generated";
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

export interface BrainResult {
  ok: boolean;
  question: string;
  plan: Plan | null;
  lanes: LaneResult[];
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
  let sqlSource: "cache" | "generated" | undefined;

  // SQL step, cache-first. A near-duplicate sub-question reuses cached SQL,
  // skipping fresh generation; we still execute it to get rows and require a
  // non-empty result, otherwise we fall back to generating.
  const lookup = await cacheLookup(node.question, {
    pool: deps.db,
    ...(deps.cacheThreshold !== undefined ? { threshold: deps.cacheThreshold } : {}),
  });
  if (lookup.hit) {
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

  // Dashboard-plan step (required for this sub-question's chart).
  const planRes = await runDashboardPlanAgent(rows, { context: deps.context });
  if (!planRes.ok) {
    return {
      ...base,
      ok: false,
      failedStage: "dashboard",
      failure: planRes.reason,
      sql,
      rows,
      sqlSource,
      ...(insight ? { insight } : {}),
      finishedAt: Date.now(),
    };
  }

  return {
    ...base,
    ok: true,
    sql,
    rows,
    sqlSource,
    ...(insight ? { insight } : {}),
    plan: planRes.data.plan,
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
    dashboard: null,
    server: null,
    ledger: getLedger(),
    totals: getTotals(),
    ...extra,
  });

  // 1. Plan the question into a DAG of sub-questions.
  const planned = await runPlanner(question, { context });
  if (!planned.ok) {
    return finish({ reason: `planner failed: ${planned.reason}` });
  }
  const plan = planned.data;
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
  const charts: DashboardChart[] = lanes
    .filter((l) => l.ok)
    .map((l) => ({
      id: l.id,
      question: l.question,
      plan: l.plan,
      data: l.rows ?? [],
      ...(l.insight ? { insight: l.insight } : {}),
    }));
  const spec: DashboardSpec = { title: question, charts };

  if (charts.length === 0) {
    return finish({ plan, lanes, reason: "no sub-question produced a usable chart" });
  }

  // 5. codeGen the combined dashboard; if it can't render, hand the broken
  //    output to codeEdit (its dedicated job).
  const codeGen = await runCodeGenAgent(spec, [], { context });
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
  const html = buildDashboardHtml(code, spec, `Hive — ${question}`);
  const server = opts.serve === false ? null : await serveDashboard(html, { port: opts.port ?? 0 });

  return {
    ok: renderOk,
    question,
    plan,
    lanes,
    dashboard: { spec, code, html, renderOk, codeEditUsed },
    server,
    ledger: getLedger(),
    totals: getTotals(),
  };
}
