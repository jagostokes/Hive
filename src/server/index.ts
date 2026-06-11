// server: Hono HTTP server exposing the brain + baseline lanes to the UI.
//
// Endpoints
//   GET  /api/models                — list brain agent roles (for UI bee mapping)
//   POST /api/run                   — start a run (brain + baseline in parallel),
//                                     returns { runId }
//   GET  /api/run/:id/events        — Server-Sent Events stream of ledger
//                                     snapshots + lane completion events
//   GET  /api/run/:id/html/:lane    — download the rendered dashboard HTML
//
// The brain and baseline lanes share the global model ledger (each entry is
// tagged with its lane). We reset the ledger once at the start, then poll
// getLedger()/getTotals() between calls to stream per-model cost into the UI.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import {
  getLedger,
  getTotals,
  resetLedger,
  type LedgerEntry,
} from "../models/index.js";
import { runBrainLane } from "../orchestrator/index.js";
import { runBaselineLane } from "../baseline/index.js";
import { MODELS, type ModelRole } from "../../config/models.js";
import { runStore, type LaneId } from "./runStore.js";
import {
  getPromptEdition,
  startTraining,
  getTrainingRun,
  listTrainingRuns,
  isTrainingActive,
  getActiveTrainingId,
  trainingEmitter,
  type TrainingMetricEvent,
} from "./trainingApi.js";

const app = new Hono();
app.use("*", cors());

const BRAIN_AGENT_ROLES: ModelRole[] = [
  "planner",
  "sqlGen",
  "insight",
  "dashboardPlan",
  "codeGen",
  "codeEdit",
];

app.get("/api/models", (c) =>
  c.json({
    brain: BRAIN_AGENT_ROLES.map((role) => describeAgent(role)),
    baseline: describeAgent("baseline"),
  }),
);

function describeAgent(role: ModelRole) {
  const slug = MODELS[role].slug;
  return {
    role,
    slug,
    label: prettyModelLabel(slug),
    params: paramsFromSlug(slug),
  };
}

// Params published in the slug name (e.g. "qwen3-coder-30b-..." → "30B").
// For slugs without a number, fall back to a small table of known totals so the
// UI can render something meaningful. Unknowns return null and the UI hides the line.
const KNOWN_PARAMS: Record<string, string> = {
  "qwen/qwen3-coder-plus": "480B",
  "deepseek/deepseek-v4-pro": "236B",
  "deepseek/deepseek-v4-flash": "16B",
  "google/gemini-2.5-flash-lite": "8B",
  "anthropic/claude-opus-4.8": "—",
  "relace/relace-apply-3": "7B",
  "openai/text-embedding-3-small": "—",
};

function paramsFromSlug(slug: string): string | null {
  const m = slug.match(/(\d+(?:\.\d+)?)\s*b\b/i);
  if (m) return `${m[1]}B`;
  return KNOWN_PARAMS[slug] ?? null;
}

// Serve the thesis paper (docs/THESIS.md) as raw markdown so the UI can render
// it in-app. Resolved relative to this source file, not cwd, so it works no
// matter where the server is launched from.
app.get("/api/thesis", async (c) => {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url)); // src/server
    const thesisPath = path.resolve(here, "../../docs/THESIS.md");
    const md = await readFile(thesisPath, "utf8");
    c.header("content-type", "text/markdown; charset=utf-8");
    return c.body(md);
  } catch {
    return c.json({ error: "thesis not found" }, 404);
  }
});

app.post("/api/run", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { question?: string };
  const question = (body.question ?? "").trim();
  if (!question) return c.json({ error: "question required" }, 400);

  const run = runStore.create(question);

  // Reset the shared ledger ONCE at the start of a paired run so brain + baseline
  // entries accumulate cleanly into byLane.brain / byLane.baseline.
  resetLedger();

  // Kick off both lanes in parallel (fire-and-forget; SSE streams progress).
  startBrain(run.id, question);
  startBaseline(run.id, question);

  return c.json({ runId: run.id });
});

app.get("/api/run/:id/events", (c) => {
  const id = c.req.param("id");
  return streamSSE(c, async (stream) => {
    let closed = false;
    const send = async (): Promise<void> => {
      const run = runStore.get(id);
      if (!run) return;
      const ledger = getLedger();
      const totals = getTotals();
      run.ledger = ledger;
      run.totals = totals;
      pruneLaneState(run, "brain", ledger);
      pruneLaneState(run, "baseline", ledger);
      await stream.writeSSE({
        data: JSON.stringify({
          brain: run.brain,
          baseline: run.baseline,
          ledger,
          totals,
        }),
      });
    };

    // Initial snapshot
    await send();

    const listener = (): Promise<void> => send();
    runStore.emitter.on(`run:${id}`, listener);

    // Keep-alive ticks (also pick up ledger growth that happens mid-call).
    const interval = setInterval(() => {
      if (closed) return;
      send().catch(() => {});
    }, 750);

    stream.onAbort(() => {
      closed = true;
      runStore.emitter.off(`run:${id}`, listener);
      clearInterval(interval);
    });

    // Hold stream open until both lanes terminate.
    while (!closed) {
      const run = runStore.get(id);
      if (!run) break;
      const done =
        (run.brain.status === "complete" || run.brain.status === "error") &&
        (run.baseline.status === "complete" || run.baseline.status === "error");
      if (done) {
        await send();
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    clearInterval(interval);
    runStore.emitter.off(`run:${id}`, listener);
  });
});

app.get("/api/run/:id/html/:lane", (c) => {
  const id = c.req.param("id");
  const lane = c.req.param("lane") as LaneId;
  const run = runStore.get(id);
  if (!run) return c.json({ error: "unknown run" }, 404);
  const html = lane === "brain" ? run.brain.html : run.baseline.html;
  if (!html) return c.json({ error: "html not ready" }, 404);
  c.header("content-type", "text/html; charset=utf-8");
  const filename = lane === "brain" ? "BRAIN-METHOD.html" : "LLM-METHOD.html";
  c.header("content-disposition", `attachment; filename="${filename}"`);
  return c.body(html);
});

// --- lane launchers ---

async function startBrain(runId: string, question: string): Promise<void> {
  runStore.update(runId, (r) => {
    r.brain.status = "running";
    r.brain.startedAt = Date.now();
  });
  try {
    // We share the ledger across both lanes in this paired run, so DO NOT let
    // the orchestrator reset it. It already gets reset once at /api/run start.
    const result = await runBrainLane(question, { serve: false, freshLedger: false });
    // Detect a full-skip cache hit (no sqlGen call). When ANY successful lane's
    // sqlSource is "cache" AND no brain-lane sqlGen ledger entry exists, sqlGen
    // was entirely skipped for that sub-question — mark the role as cached.
    const anyCachedFully = result.lanes.some((l) => l.ok && l.sqlSource === "cache");
    const sqlGenRan = result.ledger.some((e) => e.lane === "brain" && e.role === "sqlGen");
    runStore.update(runId, (r) => {
      r.brain.status = result.ok ? "complete" : "error";
      r.brain.finishedAt = Date.now();
      r.brain.html = result.dashboard?.html ?? null;
      r.brain.cachedRoles = anyCachedFully && !sqlGenRan ? ["sqlGen"] : [];
      if (!result.ok) r.brain.reason = result.reason ?? "render failed";
    });
  } catch (err) {
    runStore.update(runId, (r) => {
      r.brain.status = "error";
      r.brain.finishedAt = Date.now();
      r.brain.reason = err instanceof Error ? err.message : String(err);
    });
  }
}

async function startBaseline(runId: string, question: string): Promise<void> {
  runStore.update(runId, (r) => {
    r.baseline.status = "running";
    r.baseline.startedAt = Date.now();
  });
  try {
    const result = await runBaselineLane(question);
    runStore.update(runId, (r) => {
      r.baseline.status = result.renderOk ? "complete" : "error";
      r.baseline.finishedAt = Date.now();
      r.baseline.html = result.html;
      if (!result.renderOk) r.baseline.reason = result.reason ?? "render failed";
    });
  } catch (err) {
    runStore.update(runId, (r) => {
      r.baseline.status = "error";
      r.baseline.finishedAt = Date.now();
      r.baseline.reason = err instanceof Error ? err.message : String(err);
    });
  }
}

function pruneLaneState(
  run: { brain: any; baseline: any },
  lane: LaneId,
  ledger: LedgerEntry[],
): void {
  const own = ledger.filter((e) => e.lane === lane);
  const roles = Array.from(new Set(own.map((e) => e.role)));
  run[lane].completedRoles = roles;
  // Heuristic: while running, the last seen role is the "active" one.
  if (run[lane].status === "running" && own.length > 0) {
    run[lane].activeRole = own[own.length - 1].role;
  } else if (run[lane].status !== "running") {
    run[lane].activeRole = null;
  }
}

function prettyModelLabel(slug: string): string {
  const last = slug.split("/").pop() ?? slug;
  return last
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .replace(/\b(\d+)b\b/gi, "$1B");
}

// --- Prompt edition ---

app.get("/api/prompt-edition", async (c) => {
  try {
    const edition = await getPromptEdition();
    return c.json(edition ?? { generation: 0, diagnosis: null, winRate: null, createdAt: null });
  } catch {
    return c.json({ generation: 0, diagnosis: null, winRate: null, createdAt: null });
  }
});

// --- Synchronous ask (for embedding Hive in external tools, e.g. Hex) ---
//
// POST /api/ask { question, baseline? } -> runs the brain lane (and optionally
// the baseline lane) to completion and returns ONE JSON payload: the generated
// SQL + rows + insight per sub-question, the rendered dashboard HTML, and the
// brain-vs-baseline cost. Unlike /api/run (which streams over SSE for the live
// UI), this blocks until done so a notebook cell can `requests.post(...)` and
// read the result directly. Baseline is opt-in because it fires the expensive
// flagship model — leave it off to keep per-call cost minimal.
app.post("/api/ask", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    question?: string;
    baseline?: boolean;
  };
  const question = (body.question ?? "").trim();
  if (!question) return c.json({ error: "question required" }, 400);

  resetLedger();

  const brain = await runBrainLane(question, { serve: false, freshLedger: false });
  const baseline = body.baseline === true ? await runBaselineLane(question) : null;

  const totals = getTotals();
  const edition = await getPromptEdition().catch(() => null);

  const brainCost = totals.byLane.brain.costUsd;
  const baselineCost = totals.byLane.baseline.costUsd;
  const savingsPct =
    baseline && baselineCost > 0
      ? Math.round(((baselineCost - brainCost) / baselineCost) * 1000) / 10
      : null;

  return c.json({
    question,
    ok: brain.ok,
    promptGeneration: edition?.generation ?? 0,
    cacheHits: brain.cacheHits,
    brain: {
      ok: brain.ok,
      costUsd: brainCost,
      tokens: totals.byLane.brain.promptTokens + totals.byLane.brain.completionTokens,
      charts: brain.lanes.map((l) => ({
        question: l.question,
        sql: l.sql ?? null,
        insight: l.insight ?? null,
        rows: l.rows ?? [],
      })),
      dashboardHtml: brain.dashboard?.html ?? null,
      ...(brain.reason ? { reason: brain.reason } : {}),
    },
    ...(baseline
      ? {
          baseline: {
            ok: baseline.renderOk,
            costUsd: baselineCost,
            tokens:
              totals.byLane.baseline.promptTokens + totals.byLane.baseline.completionTokens,
            dashboardHtml: baseline.html ?? null,
            ...(baseline.reason ? { reason: baseline.reason } : {}),
          },
          savingsPct,
        }
      : {}),
  });
});

// --- Training endpoints ---

app.post("/api/train/start", async (c) => {
  if (isTrainingActive()) {
    return c.json({ error: "Training already in progress", activeId: getActiveTrainingId() }, 409);
  }
  const body = (await c.req.json().catch(() => ({}))) as { questions?: number };
  const numQuestions = Math.min(body.questions ?? 75, 75);
  try {
    const id = startTraining(numQuestions);
    return c.json({ runId: id });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

app.get("/api/train/status", (c) => {
  return c.json({
    active: isTrainingActive(),
    activeId: getActiveTrainingId(),
    runs: listTrainingRuns(),
  });
});

app.get("/api/train/:id/events", (c) => {
  const id = c.req.param("id");
  const run = getTrainingRun(id);
  if (!run) return c.json({ error: "unknown training run" }, 404);

  return streamSSE(c, async (stream) => {
    let closed = false;

    // Replay existing events (in case client connected after start)
    for (const ev of run.metrics) {
      await stream.writeSSE({ data: JSON.stringify(ev) });
    }

    // Listen for new events
    const listener = async (event: TrainingMetricEvent): Promise<void> => {
      if (closed) return;
      await stream.writeSSE({ data: JSON.stringify(event) });
    };
    trainingEmitter.on(`train:${id}`, listener);

    stream.onAbort(() => {
      closed = true;
      trainingEmitter.off(`train:${id}`, listener);
    });

    // Keep alive until training completes
    while (!closed) {
      const current = getTrainingRun(id);
      if (!current || current.status !== "running") break;
      await new Promise((r) => setTimeout(r, 500));
    }

    trainingEmitter.off(`train:${id}`, listener);
  });
});

app.get("/api/train/:id/report", (c) => {
  const id = c.req.param("id");
  const run = getTrainingRun(id);
  if (!run) return c.json({ error: "unknown training run" }, 404);
  return c.json(run);
});

// --- Server start ---

const port = Number(process.env.HIVE_UI_PORT ?? 4317);
serve({ fetch: app.fetch, port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`[hive-ui] api listening on http://localhost:${info.port}`);
});
