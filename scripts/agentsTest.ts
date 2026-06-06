/**
 * Standalone runs of the insight, dashboard-plan, codeGen, and codeEdit agents on
 * dummy data, to confirm each runs on its scoped context and its verifier gates
 * it. Chains them realistically: insight + plan from the same rows, codeGen from
 * the plan, then codeEdit fed a deliberately broken component (its dedicated job).
 *
 * Makes real model calls (lane:"brain"); no database needed. Requires
 * OPENROUTER_API_KEY; skips cleanly if missing.
 *
 * Run: npm run test:agents
 */
import "dotenv/config";
import { createContextProvider, type RawContext, type ResultRow } from "../src/context/index.js";
import {
  runInsightAgent,
  runDashboardPlanAgent,
  runCodeGenAgent,
  runCodeEditAgent,
} from "../src/agents/index.js";
import type { Attempt } from "../src/agents/index.js";

// Minimal ground truth: a revenue metric so forInsight surfaces one definition.
// No domain schema is needed — these agents carry no schema/glossary anyway.
const raw: RawContext = {
  schema: { tables: [] },
  glossary: [
    { id: 1, term: "revenue", definition: "Total money collected.", sqlExpression: "sum(amount)" },
  ],
};

const resultRows: ResultRow[] = [
  { region: "North", revenue: 12000, order_count: 320 },
  { region: "South", revenue: 9800, order_count: 210 },
  { region: "East", revenue: 15400, order_count: 410 },
  { region: "West", revenue: 7600, order_count: 150 },
];

function trail(attempts: Attempt[]): string {
  return attempts
    .map((a) => `#${a.index}[${a.phase}:${a.role}]${a.ok ? "ok" : `fail(${a.reason})`}`)
    .join("  ");
}

function header(title: string): void {
  console.log("\n" + "=".repeat(72) + "\n" + title + "\n" + "=".repeat(72));
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.log("Skipping: set OPENROUTER_API_KEY in .env to run the agents test.");
    return;
  }

  const context = createContextProvider(raw);

  // 1. insightAgent --------------------------------------------------------
  header("insightAgent (verified by insightVerifier)");
  const insight = await runInsightAgent(resultRows, { context });
  console.log("trail:", trail(insight.attempts));
  if (insight.ok) console.log("insights:\n" + insight.data.text);
  else console.log("graceful failure:", insight.reason);

  // 2. dashboardPlanAgent --------------------------------------------------
  header("dashboardPlanAgent (verified by planVerifier)");
  const planResult = await runDashboardPlanAgent(resultRows, { context });
  console.log("trail:", trail(planResult.attempts));
  if (planResult.ok) console.log("plan:", JSON.stringify(planResult.data.plan));
  else console.log("graceful failure:", planResult.reason);

  // 3. codeGenAgent (uses the plan above, or a fallback) -------------------
  header("codeGenAgent (verified by renderVerifier)");
  const plan = planResult.ok
    ? planResult.data.plan
    : { type: "bar", x: "region", y: "revenue", title: "Revenue by Region" };
  const codeGen = await runCodeGenAgent(plan, resultRows, { context });
  console.log("trail:", trail(codeGen.attempts));
  if (codeGen.ok) console.log("dashboard HTML (first 300 chars):\n" + codeGen.data.code.slice(0, 300));
  else console.log("graceful failure:", codeGen.reason);

  // 4. codeEditAgent (its job: fix a broken dashboard) ---------------------
  header("codeEditAgent (only invoked on a render failure)");
  const broken = `<div class="hive-card"><canvas id="c1"></canvas>
  <script>const rows = [1, 2, 3 ; new Chart(document.getElementById("c1"))</script>
</div>`;
  const error = "inline script syntax error: ',' expected.";
  const codeEdit = await runCodeEditAgent(broken, error, { context });
  console.log("trail:", trail(codeEdit.attempts));
  if (codeEdit.ok) console.log("fixed dashboard HTML (first 300 chars):\n" + codeEdit.data.code.slice(0, 300));
  else console.log("graceful failure:", codeEdit.reason);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
