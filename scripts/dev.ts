/**
 * Interactive dev script: prompts for a question and runs the brain vs baseline comparison.
 * 
 * Run: npm run dev
 */
import "dotenv/config";
import readline from "node:readline";
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

async function promptQuestion(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      "\n  Enter your data question (or press Enter for a demo question):\n  > ",
      (answer) => {
        rl.close();
        resolve(answer.trim());
      },
    );
  });
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY || !process.env.DATABASE_URL) {
    console.error("\n  Error: OPENROUTER_API_KEY and DATABASE_URL must be set in .env");
    console.error("  Copy .env.example to .env and fill in the values.\n");
    process.exit(1);
  }

  console.log("\n  Hive — Brain-pattern swarm vs. single strong baseline");
  console.log("  This will run both lanes and serve a comparison dashboard.\n");

  const question = await promptQuestion();
  const finalQuestion =
    question ||
    "Show me total revenue by region, the number of orders by status, and the monthly trend of revenue.";

  console.log(`\n  Running comparison for: "${finalQuestion}"\n`);

  // Seed demo data and set up context
  const cacheCutoff = new Date();
  await seed();
  const context = createContextProvider(raw);
  const db = getPool();

  const server = await serveComparison(finalQuestion, { context, db, port: 0 });

  console.log(`  Comparison running at: ${server.url}`);
  console.log("  Open the URL in your browser. Ctrl+C to stop.\n");

  const shutdown = async (): Promise<void> => {
    console.log("\n  Shutting down…");
    await server.close();
    await getPool().query(`delete from query_cache where created_at >= $1`, [cacheCutoff]).catch(() => {});
    await getPool().query(`drop table if exists ${TABLE}`).catch(() => {});
    await closePool();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("\n  Error:", err instanceof Error ? err.message : err);
  closePool().finally(() => process.exit(1));
});