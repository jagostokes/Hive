/**
 * scripts/trainReport.ts — Generate an HTML visualization from a training report JSON.
 *
 * Usage:
 *   npx tsx scripts/trainReport.ts data/reports/training_XXXXX.json
 *
 * Outputs an HTML file next to the JSON with Chart.js visualizations showing:
 *   - Token usage over time (should decrease)
 *   - Cost per question over time (should decrease)
 *   - Success rate rolling window (should increase)
 *   - Prompt evolution timeline (diffs)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface QuestionMetrics {
  questionId: number;
  question: string;
  difficulty: string;
  totalTokens: number;
  costUsd: number;
  sqlSuccess: boolean;
  firstAttemptPass: boolean;
  escalationUsed: boolean;
  attempts: number;
  promptGeneration: number;
  promptSurgeryTriggered: boolean;
  glossaryTermsAdded: string[];
  learnedExampleStored: boolean;
  elapsedMs: number;
}

interface PromptSnapshot {
  afterQuestionId: number;
  role: string;
  generation: number;
  systemPrompt: string;
  diagnosis: string | null;
  winRate: number | null;
}

interface TrainingReport {
  startedAt: string;
  finishedAt: string;
  totalQuestions: number;
  questionsRun: number;
  dataset: string;
  metrics: QuestionMetrics[];
  promptEvolution: PromptSnapshot[];
  summary: Record<string, number>;
}

function rollingAvg(arr: number[], window: number): number[] {
  return arr.map((_, i) => {
    const start = Math.max(0, i - window + 1);
    const slice = arr.slice(start, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

function generateHtml(report: TrainingReport): string {
  const metrics = report.metrics;
  const labels = metrics.map((_, i) => i + 1);
  const tokens = metrics.map((m) => m.totalTokens);
  const costs = metrics.map((m) => m.costUsd);
  const successes = metrics.map((m) => (m.sqlSuccess ? 1 : 0));
  const rollingSuccess = rollingAvg(successes, 5).map((v) => v * 100);
  const rollingTokens = rollingAvg(tokens, 5);

  const promptSnapshots = report.promptEvolution || [];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hive Training Report</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>body { background: #0f172a; color: #e2e8f0; font-family: ui-sans-serif, system-ui, sans-serif; }</style>
</head>
<body class="p-8">
<h1 class="text-3xl font-bold mb-2">🧠 Hive Training Report</h1>
<p class="text-[#94a3b8] mb-8">
  ${report.questionsRun} questions · ${report.dataset} dataset ·
  ${new Date(report.startedAt).toLocaleString()} — ${new Date(report.finishedAt).toLocaleString()}
</p>

<!-- Summary cards -->
<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
  <div class="bg-[#1e293b] rounded-xl p-5 border border-[#334155]">
    <div class="text-3xl font-bold text-[#6366f1]">${(report.summary.overallSuccessRate * 100).toFixed(1)}%</div>
    <div class="text-[#94a3b8] text-sm mt-1">Overall Success Rate</div>
  </div>
  <div class="bg-[#1e293b] rounded-xl p-5 border border-[#334155]">
    <div class="text-3xl font-bold text-[#10b981]">${(report.summary.firstAttemptPassRate * 100).toFixed(1)}%</div>
    <div class="text-[#94a3b8] text-sm mt-1">First-Attempt Pass</div>
  </div>
  <div class="bg-[#1e293b] rounded-xl p-5 border border-[#334155]">
    <div class="text-3xl font-bold text-[#f59e0b]">$${report.summary.totalCostUsd.toFixed(4)}</div>
    <div class="text-[#94a3b8] text-sm mt-1">Total Cost</div>
  </div>
  <div class="bg-[#1e293b] rounded-xl p-5 border border-[#334155]">
    <div class="text-3xl font-bold text-[#ec4899]">${report.summary.promptSurgeries}</div>
    <div class="text-[#94a3b8] text-sm mt-1">Prompt Surgeries</div>
  </div>
</div>

<!-- Improvement trajectory -->
<div class="bg-[#1e293b] rounded-xl p-5 border border-[#334155] mb-8">
  <h2 class="text-lg font-semibold mb-3">📈 Improvement Trajectory (first 10 → last 10)</h2>
  <div class="grid grid-cols-3 gap-4 text-center">
    <div>
      <div class="text-[#94a3b8] text-xs">Success Rate</div>
      <div class="text-lg"><span class="text-[#f87171]">${(report.summary.firstTenSuccessRate * 100).toFixed(0)}%</span> → <span class="text-[#10b981]">${(report.summary.lastTenSuccessRate * 100).toFixed(0)}%</span></div>
    </div>
    <div>
      <div class="text-[#94a3b8] text-xs">Avg Tokens</div>
      <div class="text-lg"><span class="text-[#f87171]">${Math.round(report.summary.firstTenAvgTokens)}</span> → <span class="text-[#10b981]">${Math.round(report.summary.lastTenAvgTokens)}</span></div>
    </div>
    <div>
      <div class="text-[#94a3b8] text-xs">Avg Cost</div>
      <div class="text-lg"><span class="text-[#f87171]">$${report.summary.firstTenAvgCost.toFixed(4)}</span> → <span class="text-[#10b981]">$${report.summary.lastTenAvgCost.toFixed(4)}</span></div>
    </div>
  </div>
</div>

<!-- Charts -->
<div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
  <div class="bg-[#1e293b] rounded-xl p-5 border border-[#334155]">
    <h3 class="text-sm font-semibold mb-2">Tokens per Question (5-question rolling avg)</h3>
    <div class="relative" style="height:260px"><canvas id="chart-tokens"></canvas></div>
  </div>
  <div class="bg-[#1e293b] rounded-xl p-5 border border-[#334155]">
    <h3 class="text-sm font-semibold mb-2">Success Rate (5-question rolling %)</h3>
    <div class="relative" style="height:260px"><canvas id="chart-success"></canvas></div>
  </div>
  <div class="bg-[#1e293b] rounded-xl p-5 border border-[#334155]">
    <h3 class="text-sm font-semibold mb-2">Cost per Question ($)</h3>
    <div class="relative" style="height:260px"><canvas id="chart-cost"></canvas></div>
  </div>
  <div class="bg-[#1e293b] rounded-xl p-5 border border-[#334155]">
    <h3 class="text-sm font-semibold mb-2">Per-Question Result (green=pass, red=fail)</h3>
    <div class="relative" style="height:260px"><canvas id="chart-results"></canvas></div>
  </div>
</div>

<!-- Prompt Evolution -->
<div class="bg-[#1e293b] rounded-xl p-5 border border-[#334155] mb-8">
  <h2 class="text-lg font-semibold mb-4">🔧 Prompt Evolution (sqlGen)</h2>
  <div class="space-y-4 max-h-[600px] overflow-y-auto">
    ${promptSnapshots
      .filter((s) => s.role === "sqlGen")
      .map(
        (s) => `
    <div class="border-l-2 border-[#6366f1] pl-4">
      <div class="flex items-center gap-2 mb-1">
        <span class="text-xs font-mono bg-[#334155] px-2 py-0.5 rounded">Gen ${s.generation}</span>
        ${s.diagnosis ? `<span class="text-xs text-[#94a3b8]">Diagnosis: ${escapeHtml(s.diagnosis)}</span>` : ""}
        ${s.winRate !== null ? `<span class="text-xs text-[#10b981]">Win rate: ${(s.winRate * 100).toFixed(0)}%</span>` : ""}
      </div>
      <pre class="text-xs text-[#94a3b8] whitespace-pre-wrap max-h-32 overflow-y-auto bg-[#0f172a] rounded p-2">${escapeHtml(s.systemPrompt.slice(0, 500))}${s.systemPrompt.length > 500 ? "..." : ""}</pre>
    </div>`,
      )
      .join("\n")}
    ${promptSnapshots.filter((s) => s.role === "sqlGen").length === 0 ? '<p class="text-[#94a3b8] text-sm">No prompt modifications yet — all questions passed without surgery.</p>' : ""}
  </div>
</div>

<script>
const labels = ${JSON.stringify(labels)};
const PALETTE = ["#6366f1","#8b5cf6","#ec4899","#f59e0b","#10b981","#3b82f6"];
const chartOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: "#94a3b8" }, grid: { color: "#1e293b" } }, y: { ticks: { color: "#94a3b8" }, grid: { color: "#1e293b" } } } };

new Chart(document.getElementById("chart-tokens"), {
  type: "line",
  data: { labels, datasets: [{ data: ${JSON.stringify(rollingTokens.map(Math.round))}, borderColor: "#6366f1", tension: 0.3, pointRadius: 0 }] },
  options: { ...chartOpts, scales: { ...chartOpts.scales, y: { ...chartOpts.scales.y, beginAtZero: true } } }
});

new Chart(document.getElementById("chart-success"), {
  type: "line",
  data: { labels, datasets: [{ data: ${JSON.stringify(rollingSuccess.map((v) => Math.round(v)))}, borderColor: "#10b981", tension: 0.3, pointRadius: 0, fill: true, backgroundColor: "rgba(16,185,129,0.1)" }] },
  options: { ...chartOpts, scales: { ...chartOpts.scales, y: { ...chartOpts.scales.y, min: 0, max: 100 } } }
});

new Chart(document.getElementById("chart-cost"), {
  type: "bar",
  data: { labels, datasets: [{ data: ${JSON.stringify(costs.map((c) => +c.toFixed(5)))}, backgroundColor: "#f59e0b", borderRadius: 4 }] },
  options: { ...chartOpts, scales: { ...chartOpts.scales, y: { ...chartOpts.scales.y, beginAtZero: true } } }
});

new Chart(document.getElementById("chart-results"), {
  type: "bar",
  data: { labels, datasets: [{ data: ${JSON.stringify(successes)}, backgroundColor: ${JSON.stringify(successes.map((s) => (s ? "#10b981" : "#f87171")))}, borderRadius: 2 }] },
  options: { ...chartOpts, scales: { ...chartOpts.scales, y: { ...chartOpts.scales.y, min: 0, max: 1, ticks: { ...chartOpts.scales.y.ticks, stepSize: 1, callback: (v) => v === 1 ? "Pass" : "Fail" } } } }
});
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Main
const inputFile = process.argv[2];
if (!inputFile) {
  console.error("Usage: npx tsx scripts/trainReport.ts <report.json>");
  process.exit(1);
}

const reportPath = resolve(inputFile);
const report = JSON.parse(readFileSync(reportPath, "utf-8")) as TrainingReport;
const htmlPath = reportPath.replace(/\.json$/, ".html");
writeFileSync(htmlPath, generateHtml(report));
console.log(`Report generated: ${htmlPath}`);
