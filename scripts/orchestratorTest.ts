/**
 * End-to-end test of the BRAIN lane orchestrator (Prompt 7 checkpoint):
 *  - parallel lanes actually run concurrently (overlapping start/finish times),
 *  - the dashboard is served on localhost and returns renderable HTML,
 *  - the brain ledger total looks sane.
 *
 * Seeds a throwaway table, runs a multi-part question, prints timings + ledger,
 * fetches the served page, then cleans up (table, cache rows, server, pool).
 *
 * Makes real model calls and needs a DB. Requires OPENROUTER_API_KEY +
 * DATABASE_URL; skips cleanly if either is missing.
 *
 * Run: npm run test:orchestrator
 */
import "dotenv/config";
import { getPool, closePool } from "../src/db/index.js";
import { createContextProvider, type RawContext } from "../src/context/index.js";
import { runBrainLane } from "../src/orchestrator/index.js";

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
       amount numeric not null, created_at timestamptz default now()
     )`,
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

function section(t: string): void {
  console.log("\n" + "=".repeat(72) + "\n" + t + "\n" + "=".repeat(72));
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY || !process.env.DATABASE_URL) {
    console.log("Skipping: set OPENROUTER_API_KEY and DATABASE_URL in .env to run the orchestrator test.");
    return;
  }

  const context = createContextProvider(raw);
  const db = getPool();
  const cacheCutoff = new Date();
  let server = null as Awaited<ReturnType<typeof runBrainLane>>["server"];

  try {
    await seed();

    const question =
      "Show me total revenue by region, the number of orders by status, and the monthly trend of revenue.";
    console.log(`Question: ${question}`);

    const t0 = Date.now();
    const result = await runBrainLane(question, { context, db, serve: true, port: 0 });
    const elapsed = Date.now() - t0;
    server = result.server;

    section("PLAN (DAG)");
    result.plan?.groups.forEach((g, i) => console.log(`  group ${i}: [${g.join(", ")}]`));

    section("LANES (concurrency proof — times relative to run start)");
    for (const l of result.lanes) {
      console.log(
        `  ${l.id} ${l.ok ? "ok " : "FAIL"} src=${l.sqlSource ?? "-"} ` +
          `start=+${l.startedAt - t0}ms end=+${l.finishedAt - t0}ms (${l.finishedAt - l.startedAt}ms)` +
          `  "${l.question}"${l.failure ? ` [${l.failedStage}: ${l.failure}]` : ""}`,
      );
    }
    // Concurrency: within the first multi-lane group, the latest start must be
    // before the earliest finish (i.e. they were running at the same instant).
    const firstGroupIds = result.plan?.groups[0] ?? [];
    const firstGroupLanes = result.lanes.filter((l) => firstGroupIds.includes(l.id));
    if (firstGroupLanes.length >= 2) {
      const latestStart = Math.max(...firstGroupLanes.map((l) => l.startedAt));
      const earliestFinish = Math.min(...firstGroupLanes.map((l) => l.finishedAt));
      const overlap = earliestFinish - latestStart;
      console.log(
        `\n  Group 0 has ${firstGroupLanes.length} lanes; overlap window = ${overlap}ms ` +
          `-> ${overlap > 0 ? "CONCURRENT (PASS)" : "NOT concurrent (FAIL)"}`,
      );
      if (overlap <= 0) process.exitCode = 1;
    } else {
      console.log("\n  (First group had <2 lanes; cannot demonstrate concurrency.)");
    }

    section("DASHBOARD");
    console.log(`  charts coalesced: ${result.dashboard?.spec.charts.length ?? 0}`);
    console.log(`  renderOk: ${result.dashboard?.renderOk}  codeEditUsed: ${result.dashboard?.codeEditUsed}`);
    console.log(`  served at: ${server?.url ?? "(not served)"}`);

    if (server) {
      const res = await fetch(server.url);
      const html = await res.text();
      const looksRenderable =
        res.status === 200 &&
        html.includes('id="hive-root"') &&
        html.includes("chart.js") &&
        /<canvas\b|<svg\b|new\s+Chart\s*\(|<table\b/i.test(html);
      console.log(`  GET ${server.url} -> HTTP ${res.status}, ${html.length} bytes, renderable=${looksRenderable}`);
      if (!looksRenderable) process.exitCode = 1;
    }

    section("BRAIN LEDGER");
    const brain = result.totals.byLane.brain;
    console.log(`  calls=${brain.calls}  promptTokens=${brain.promptTokens}  completionTokens=${brain.completionTokens}`);
    console.log(`  cost=$${brain.costUsd.toFixed(6)}  (total run elapsed ${elapsed}ms)`);
    console.log("  per-call:");
    for (const e of result.ledger) {
      console.log(`    [${e.lane}] ${e.role.padEnd(13)} ${e.promptTokens}+${e.completionTokens} tok  $${e.costUsd.toFixed(6)}  ${e.model}`);
    }

    console.log(`\n  overall ok=${result.ok}`);
  } finally {
    if (server) await server.close();
    await getPool()
      .query(`delete from query_cache where created_at >= $1`, [cacheCutoff])
      .catch(() => {});
    await getPool().query(`drop table if exists ${TABLE}`).catch(() => {});
    await closePool();
  }
}

main().catch((err) => {
  console.error(err);
  closePool().finally(() => process.exit(1));
});
