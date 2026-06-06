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
  glossary: [{ id: 1, term: "revenue", definition: "Total money (sum of amount).", sqlExpression: "sum(amount)" }],
};

const Q = "What is the average order value for each region, what percentage of total revenue does each region contribute, and which region has the highest average order amount?";

async function main(): Promise<void> {
  const pool = getPool();
  await pool.query(`drop table if exists ${TABLE}`);
  await pool.query(
    `create table ${TABLE} (id bigserial primary key, region text, status text, amount numeric, created_at timestamptz default now())`,
  );
  await pool.query(
    `insert into ${TABLE} (region,status,amount,created_at) values
      ('North','paid',120,now()),('North','refunded',40,now()),('South','paid',80,now()),
      ('East','paid',200,now()),('West','pending',15,now()),('East','paid',95,now())`,
  );
  // Clear any cached SQL for this question family so each run is a true test.
  await pool.query(`delete from query_cache where question_text ilike '%average order%' or question_text ilike '%percentage%'`).catch(() => {});

  const N = 3;
  let ok = 0;
  for (let i = 1; i <= N; i++) {
    const t0 = Date.now();
    const r = await runBrainLane(Q, { context: createContextProvider(raw), db: pool, serve: false });
    const fallbackUsed = r.lanes.some((l) => l.id === "main");
    console.log(
      `run ${i}: ok=${r.ok} charts=${r.dashboard?.spec.charts.length ?? 0} fallback=${fallbackUsed} ` +
        `cost=$${r.totals.byLane.brain.costUsd.toFixed(5)} ${Date.now() - t0}ms reason=${r.reason ?? "-"}`,
    );
    if (r.ok) ok++;
  }
  console.log(`\n${ok}/${N} runs produced a dashboard`);

  await pool.query(`drop table if exists ${TABLE}`);
  await closePool();
}

main().catch((e) => {
  console.error(e);
  closePool().finally(() => process.exit(1));
});
