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
    brain: BRAIN_AGENT_ROLES.map((role) => ({
      role,
      slug: MODELS[role].slug,
      label: prettyModelLabel(MODELS[role].slug),
    })),
    baseline: {
      role: "baseline" as ModelRole,
      slug: MODELS.baseline.slug,
      label: prettyModelLabel(MODELS.baseline.slug),
    },
  }),
);

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
  c.header(
    "content-disposition",
    `attachment; filename="hive-${lane}-${id.slice(0, 8)}.html"`,
  );
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
    runStore.update(runId, (r) => {
      r.brain.status = result.ok ? "complete" : "error";
      r.brain.finishedAt = Date.now();
      r.brain.html = result.dashboard?.html ?? null;
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

const port = Number(process.env.HIVE_UI_PORT ?? 4317);
serve({ fetch: app.fetch, port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`[hive-ui] api listening on http://localhost:${info.port}`);
});
