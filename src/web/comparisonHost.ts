// web/comparisonHost: the whole pitch on one screen. Runs the BRAIN lane and the
// BASELINE lane for one question (concurrently, sharing one ledger), and serves a
// localhost page showing both rendered dashboards side by side with LIVE token
// counters, cost, and % savings read straight from getTotals() per lane.
import http from "node:http";
import type { Pool } from "pg";
import { getPool } from "../db/index.js";
import { buildContext, type ContextProvider } from "../context/index.js";
import { getTotals, getLedger, resetLedger, type Lane } from "../models/index.js";
import { runBrainLane } from "../orchestrator/index.js";
import { runBaselineLane } from "../baseline/index.js";

interface LaneState {
  status: "running" | "done" | "failed" | "error";
  html: string | null;
  error?: string;
}

interface ComparisonState {
  question: string;
  brain: LaneState;
  baseline: LaneState;
  done: boolean;
}

export interface ComparisonServer {
  url: string;
  port: number;
  /** Resolves when BOTH lanes have settled. */
  done: Promise<void>;
  close: () => Promise<void>;
}

export interface ComparisonOptions {
  context?: ContextProvider;
  db?: Pool;
  port?: number;
}

export async function serveComparison(
  question: string,
  opts: ComparisonOptions = {},
): Promise<ComparisonServer> {
  // One ledger for the whole comparison; lanes append, grouped by their tag.
  resetLedger();

  const db = opts.db ?? getPool();
  const context = opts.context ?? (await buildContext(db));

  const state: ComparisonState = {
    question,
    brain: { status: "running", html: null },
    baseline: { status: "running", html: null },
    done: false,
  };

  // Kick off both lanes concurrently. They write to the shared ledger as calls
  // complete, so the live counters reflect real progress. Brain must NOT reset
  // the ledger (freshLedger:false) or it would wipe the baseline's entries.
  const brainP = runBrainLane(question, { serve: false, freshLedger: false, context, db })
    .then((r) => {
      state.brain = {
        status: r.ok ? "done" : "failed",
        html: r.dashboard?.html ?? laneErrorHtml("brain", r.reason ?? "no dashboard produced"),
        ...(r.reason ? { error: r.reason } : {}),
      };
    })
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      state.brain = { status: "error", html: laneErrorHtml("brain", msg), error: msg };
    });

  const baselineP = runBaselineLane(question, { context, db })
    .then((r) => {
      state.baseline = {
        status: r.ok ? "done" : "failed",
        html: r.html || laneErrorHtml("baseline", r.reason ?? "no dashboard produced"),
        ...(r.reason ? { error: r.reason } : {}),
      };
    })
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      state.baseline = { status: "error", html: laneErrorHtml("baseline", msg), error: msg };
    });

  const done = Promise.allSettled([brainP, baselineP]).then(() => {
    state.done = true;
  });

  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (url.startsWith("/api/state")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(buildStatePayload(state)));
    } else if (url.startsWith("/brain")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(state.brain.html ?? laneRunningHtml("brain"));
    } else if (url.startsWith("/baseline")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(state.baseline.html ?? laneRunningHtml("baseline"));
    } else {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(comparisonPageHtml(question));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, resolve);
  });

  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : (opts.port ?? 0);
  return {
    url: `http://localhost:${port}`,
    port,
    done,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function uniqueModels(lane: Lane): string[] {
  return [...new Set(getLedger().filter((e) => e.lane === lane).map((e) => e.model))];
}

// Live per-lane numbers straight from the real ledger — never mocked.
export function buildStatePayload(state: ComparisonState): unknown {
  const totals = getTotals();
  const b = totals.byLane.brain;
  const x = totals.byLane.baseline;
  const savingsPct = x.costUsd > 0 ? (1 - b.costUsd / x.costUsd) * 100 : null;

  return {
    question: state.question,
    done: state.done,
    brain: {
      status: state.brain.status,
      calls: b.calls,
      promptTokens: b.promptTokens,
      completionTokens: b.completionTokens,
      costUsd: b.costUsd,
      models: uniqueModels("brain"),
    },
    baseline: {
      status: state.baseline.status,
      calls: x.calls,
      promptTokens: x.promptTokens,
      completionTokens: x.completionTokens,
      costUsd: x.costUsd,
      models: uniqueModels("baseline"),
    },
    savingsPct,
  };
}

function laneRunningHtml(label: string): string {
  return `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui,sans-serif;color:#8b95a5;background:#0b0e14;display:grid;place-items:center;height:100vh;margin:0">Running the ${label} lane…</body>`;
}

function laneErrorHtml(label: string, reason: string): string {
  return `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui,sans-serif;color:#ff6b6b;background:#0b0e14;padding:24px;margin:0"><h3>${label} lane failed</h3><pre style="white-space:pre-wrap">${reason.replace(/</g, "&lt;")}</pre></body>`;
}

function comparisonPageHtml(question: string): string {
  const q = question.replace(/</g, "&lt;");
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Hive — Brain vs Baseline</title>
<style>
  :root { --bg:#0b0e14; --panel:#11151f; --border:#232a36; --fg:#e6e6e6; --muted:#8b95a5; --brain:#4ade80; --base:#f59e0b; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: ui-sans-serif, system-ui, sans-serif; background:var(--bg); color:var(--fg); }
  header { padding:16px 24px; border-bottom:1px solid var(--border); }
  header h1 { font-size:16px; margin:0 0 4px; }
  header .q { color:var(--muted); font-size:13px; }
  .savings { margin-top:10px; font-size:14px; }
  .savings b { font-size:28px; color:var(--brain); }
  .cols { display:grid; grid-template-columns:1fr 1fr; gap:0; height:calc(100vh - 96px); }
  .col { display:flex; flex-direction:column; border-right:1px solid var(--border); min-width:0; }
  .col:last-child { border-right:none; }
  .lane-head { padding:12px 16px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; }
  .lane-title { font-weight:600; }
  .brain .dot { color:var(--brain); } .baseline .dot { color:var(--base); }
  .stats { display:flex; gap:18px; padding:10px 16px; font-size:12px; color:var(--muted); flex-wrap:wrap; border-bottom:1px solid var(--border); }
  .stats .n { color:var(--fg); font-variant-numeric:tabular-nums; font-weight:600; }
  .models { padding:6px 16px; font-size:11px; color:var(--muted); border-bottom:1px solid var(--border); min-height:26px; }
  iframe { border:0; flex:1; width:100%; background:#fff; }
  .status { font-size:12px; color:var(--muted); }
</style></head>
<body>
<header>
  <h1>Hive — brain-pattern swarm vs. single strong baseline</h1>
  <div class="q">${q}</div>
  <div class="savings">Cost savings (brain vs baseline): <b id="savings">—</b> <span class="status" id="overall">running…</span></div>
</header>
<div class="cols">
  <div class="col brain">
    <div class="lane-head"><span class="lane-title"><span class="dot">●</span> Brain lane</span><span class="status" id="brain-status">running…</span></div>
    <div class="stats">
      <div>in <span class="n" id="brain-in">0</span></div>
      <div>out <span class="n" id="brain-out">0</span></div>
      <div>calls <span class="n" id="brain-calls">0</span></div>
      <div>cost <span class="n" id="brain-cost">$0.000000</span></div>
    </div>
    <div class="models" id="brain-models"></div>
    <iframe id="brain-frame" title="brain dashboard"></iframe>
  </div>
  <div class="col baseline">
    <div class="lane-head"><span class="lane-title"><span class="dot">●</span> Baseline lane</span><span class="status" id="baseline-status">running…</span></div>
    <div class="stats">
      <div>in <span class="n" id="baseline-in">0</span></div>
      <div>out <span class="n" id="baseline-out">0</span></div>
      <div>calls <span class="n" id="baseline-calls">0</span></div>
      <div>cost <span class="n" id="baseline-cost">$0.000000</span></div>
    </div>
    <div class="models" id="baseline-models"></div>
    <iframe id="baseline-frame" title="baseline dashboard"></iframe>
  </div>
</div>
<script>
  const framesLoaded = { brain:false, baseline:false };
  const fmt = (n) => Number(n).toLocaleString();
  function laneUpdate(lane, d) {
    document.getElementById(lane+'-in').textContent = fmt(d.promptTokens);
    document.getElementById(lane+'-out').textContent = fmt(d.completionTokens);
    document.getElementById(lane+'-calls').textContent = fmt(d.calls);
    document.getElementById(lane+'-cost').textContent = '$' + Number(d.costUsd).toFixed(6);
    document.getElementById(lane+'-status').textContent = d.status;
    document.getElementById(lane+'-models').textContent = d.models.length ? 'models: ' + d.models.join(', ') : '';
    if ((d.status === 'done' || d.status === 'failed' || d.status === 'error') && !framesLoaded[lane]) {
      framesLoaded[lane] = true;
      document.getElementById(lane+'-frame').src = '/' + lane + '?t=' + Date.now();
    }
  }
  async function poll() {
    try {
      const r = await fetch('/api/state'); const s = await r.json();
      laneUpdate('brain', s.brain); laneUpdate('baseline', s.baseline);
      document.getElementById('savings').textContent = s.savingsPct == null ? '—' : s.savingsPct.toFixed(1) + '%';
      document.getElementById('overall').textContent = s.done ? 'complete' : 'running…';
      if (!s.done) setTimeout(poll, 1000);
    } catch (e) { setTimeout(poll, 1500); }
  }
  poll();
</script>
</body></html>`;
}
