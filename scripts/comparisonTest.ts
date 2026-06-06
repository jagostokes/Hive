/**
 * Prompt 8 checkpoint: run ONE question through both lanes and confirm
 *  - both dashboards render (served HTML is renderable),
 *  - the savings number is real (read from getTotals() per lane) and large.
 *
 * Seeds a throwaway table, runs the comparison host headless, asserts, cleans up.
 * Requires OPENROUTER_API_KEY + DATABASE_URL; skips cleanly otherwise.
 *
 * Run: npm run test:comparison
 */
import "dotenv/config";
import { getPool, closePool } from "../src/db/index.js";
import { createContextProvider, type RawContext } from "../src/context/index.js";
import { serveComparison } from "../src/web/index.js";

const TABLE = "agent_demo_orders";

const raw: RawContext = {
  schema: {
    tables: [
      {
        schema: "public",
        name: TABLE,
        columns: [
          { name: "id", type: "int8", nullable: false },
          { name: "region", type: "text", nullable: false },
          { name: "status", type: "text", nullable: false },
          { name: "amount", type: "numeric", nullable: false },
          { name: "created_at", type: "timestamptz", nullable: true },
        ],
      },
    ],
  },
  glossary: [
    { id: 1, term: "revenue", definition: "Total money across orders.", sqlExpression: "sum(amount)" },
  ],
};

async function seed(): Promise<void> {
  const pool = getPool();
  await pool.query(`drop table if exists ${TABLE}`);
  await pool.query(
    `create table ${TABLE} (
       id bigserial primary key, region text not null, status text not null,
       amount numeric not null, created_at timestamptz default now())`,
  );
  await pool.query(
    `insert into ${TABLE} (region, status, amount, created_at) values
       ('North','paid',120, now() - interval '5 days'),
       ('North','refunded',40, now() - interval '40 days'),
       ('South','paid',80, now() - interval '10 days'),
       ('East','paid',200, now() - interval '70 days'),
       ('West','pending',15, now() - interval '2 days'),
       ('East','paid',95, now() - interval '35 days')`,
  );
}

async function renderable(url: string): Promise<{ status: number; ok: boolean; bytes: number }> {
  const r = await fetch(url);
  const html = await r.text();
  // The Chart.js shell: a mount point, the Chart.js CDN, the embedded data
  // global, and at least one visualization (canvas/svg/table or a Chart.js call).
  const ok =
    r.status === 200 &&
    html.includes('id="hive-root"') &&
    html.includes("chart.js") &&
    html.includes("window.DASHBOARD_DATA") &&
    /<canvas\b|<svg\b|new\s+Chart\s*\(|<table\b/i.test(html);
  return { status: r.status, ok, bytes: html.length };
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY || !process.env.DATABASE_URL) {
    console.log("Skipping: set OPENROUTER_API_KEY and DATABASE_URL in .env to run the comparison test.");
    return;
  }

  const context = createContextProvider(raw);
  const db = getPool();
  const cacheCutoff = new Date();
  let server: Awaited<ReturnType<typeof serveComparison>> | null = null;

  try {
    await seed();
    const question = "Show me total revenue by region and the number of orders by status.";
    console.log(`Question: ${question}`);

    server = await serveComparison(question, { context, db, port: 0 });
    console.log(`Comparison host: ${server.url}  (waiting for both lanes…)`);
    await server.done;

    const state = (await (await fetch(`${server.url}/api/state`)).json()) as {
      done: boolean;
      brain: { status: string; promptTokens: number; completionTokens: number; costUsd: number; models: string[] };
      baseline: { status: string; promptTokens: number; completionTokens: number; costUsd: number; models: string[] };
      savingsPct: number | null;
    };

    const brainFrame = await renderable(`${server.url}/brain`);
    const baseFrame = await renderable(`${server.url}/baseline`);

    console.log("\n=== BRAIN ===");
    console.log(`  status=${state.brain.status} in=${state.brain.promptTokens} out=${state.brain.completionTokens} cost=$${state.brain.costUsd.toFixed(6)}`);
    console.log(`  models: ${state.brain.models.join(", ")}`);
    console.log(`  dashboard: HTTP ${brainFrame.status}, renderable=${brainFrame.ok}, ${brainFrame.bytes} bytes`);

    console.log("\n=== BASELINE ===");
    console.log(`  status=${state.baseline.status} in=${state.baseline.promptTokens} out=${state.baseline.completionTokens} cost=$${state.baseline.costUsd.toFixed(6)}`);
    console.log(`  models: ${state.baseline.models.join(", ")}`);
    console.log(`  dashboard: HTTP ${baseFrame.status}, renderable=${baseFrame.ok}, ${baseFrame.bytes} bytes`);

    console.log("\n=== COMPARISON ===");
    console.log(`  savings (brain vs baseline): ${state.savingsPct == null ? "n/a" : state.savingsPct.toFixed(1) + "%"}`);

    const bothRender = brainFrame.ok && baseFrame.ok;
    const savingsReal = state.savingsPct != null && state.savingsPct > 0;
    console.log(
      `\n  CHECK: bothRender=${bothRender}, savingsPositive=${savingsReal} -> ${bothRender && savingsReal ? "PASS" : "FAIL"}`,
    );
    if (!(bothRender && savingsReal)) process.exitCode = 1;
  } finally {
    if (server) await server.close();
    await getPool().query(`delete from query_cache where created_at >= $1`, [cacheCutoff]).catch(() => {});
    await getPool().query(`drop table if exists ${TABLE}`).catch(() => {});
    await closePool();
  }
}

main().catch((err) => {
  console.error(err);
  closePool().finally(() => process.exit(1));
});
