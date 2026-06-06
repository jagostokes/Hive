/**
 * Integration test for the SQL sub-agent against a seeded dummy table.
 *
 * Seeds a throwaway table, then runs the agent on:
 *   1. an ANSWERABLE question  -> expect ok, with SQL + rows on the first try.
 *   2. a deliberately UNANSWERABLE question whose correct result is empty given
 *      the seed data (no 'cancelled' orders). The verifier rejects 0-row results,
 *      so every attempt fails -> retry on the cheap model, escalate ONCE, then
 *      HARD-STOP with a graceful failure (the point is to watch it escalate and
 *      stop, not loop).
 *
 * Makes real model calls and needs a database. Requires OPENROUTER_API_KEY and
 * DATABASE_URL; skips cleanly if either is missing.
 *
 * Run: npm run test:sql-agent
 */
import "dotenv/config";
import { getPool, closePool } from "../src/db/index.js";
import { createContextProvider, type RawContext } from "../src/context/index.js";
import { runSqlAgent, type SqlAgentResult } from "../src/agents/index.js";

const TABLE = "agent_demo_orders";

// Hand-built ground truth describing ONLY the dummy table, so the SQL agent's
// scoped context is clean and deterministic. The query still runs against the
// real seeded table for verification + rows.
const raw: RawContext = {
  schema: {
    tables: [
      {
        schema: "public",
        name: TABLE,
        columns: [
          { name: "id", type: "int8", nullable: false },
          { name: "status", type: "text", nullable: false },
          { name: "amount", type: "numeric", nullable: false },
          { name: "created_at", type: "timestamptz", nullable: true },
        ],
      },
    ],
  },
  glossary: [
    {
      id: 1,
      term: "revenue",
      definition: "Total money across orders.",
      sqlExpression: "sum(amount)",
    },
  ],
};

async function seed(): Promise<void> {
  const pool = getPool();
  await pool.query(`drop table if exists ${TABLE}`);
  await pool.query(
    `create table ${TABLE} (
       id bigserial primary key,
       status text not null,
       amount numeric not null,
       created_at timestamptz default now()
     )`,
  );
  await pool.query(
    `insert into ${TABLE} (status, amount) values
       ('paid', 120.00), ('paid', 80.50), ('refunded', 40.00),
       ('pending', 15.25), ('paid', 200.00)`,
  );
}

async function cleanup(): Promise<void> {
  await getPool().query(`drop table if exists ${TABLE}`);
}

function printResult(label: string, result: SqlAgentResult): void {
  console.log("\n" + "=".repeat(72));
  console.log(label);
  console.log("=".repeat(72));
  console.log(`outcome: ${result.ok ? "OK" : "FAILED (graceful)"}`);
  console.log(`models used: ${result.modelsUsed.join(" -> ")}`);
  if (result.ok) {
    console.log(`\nSQL:\n${result.output}`);
    console.log(`\nrows (${result.data.rows.length}):`);
    console.log(JSON.stringify(result.data.rows, null, 2));
  } else {
    console.log(`reason: ${result.reason}`);
  }
  console.log("\nattempt trail:");
  for (const a of result.attempts) {
    console.log(
      `  #${a.index} [${a.phase}] ${a.model} -> ${a.ok ? "ok" : "fail"}` +
        `${a.reason ? `  reason="${a.reason}"` : ""}`,
    );
  }
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY || !process.env.DATABASE_URL) {
    console.log(
      "Skipping: set OPENROUTER_API_KEY and DATABASE_URL in .env to run the SQL agent test.",
    );
    return;
  }

  const context = createContextProvider(raw);
  const db = getPool();

  try {
    await seed();

    const answerable = await runSqlAgent(
      "What is the total order amount for each status?",
      { context, db },
    );
    printResult("ANSWERABLE: total amount per status", answerable);

    const unanswerable = await runSqlAgent(
      "List every order whose status is 'cancelled'.",
      { context, db },
    );
    printResult("UNANSWERABLE: orders with a status that has no rows", unanswerable);

    console.log("\n" + "-".repeat(72));
    console.log(
      `Control-flow check: answerable.ok=${answerable.ok}, ` +
        `unanswerable attempts=${unanswerable.attempts.length} ` +
        `(cap is 2 cheap + 1 escalation = 3), unanswerable.ok=${unanswerable.ok}`,
    );
  } finally {
    await cleanup().catch(() => {});
    await closePool();
  }
}

main().catch((err) => {
  console.error(err);
  closePool().finally(() => process.exit(1));
});
