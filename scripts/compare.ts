/**
 * Interactive comparison demo: seeds demo data, serves the brain-vs-baseline
 * comparison page on localhost, and stays up so you can open it in a browser and
 * watch the live token/cost counters and both dashboards render side by side.
 *
 *   npm run compare -- "Show me total revenue by region and orders by status"
 *
 * Ctrl+C to stop (cleans up the demo table and cache rows).
 * Requires OPENROUTER_API_KEY + DATABASE_URL.
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

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY || !process.env.DATABASE_URL) {
    console.error("Set OPENROUTER_API_KEY and DATABASE_URL in .env first.");
    process.exit(1);
  }

  const question =
    process.argv.slice(2).join(" ").trim() ||
    "Show me total revenue by region, the number of orders by status, and the monthly trend of revenue.";

  const cacheCutoff = new Date();
  await seed();
  const context = createContextProvider(raw);
  const server = await serveComparison(question, { context, db: getPool(), port: 0 });

  console.log(`\n  Hive comparison running at:  ${server.url}`);
  console.log(`  Question: ${question}`);
  console.log(`  Open the URL in your browser. Ctrl+C to stop.\n`);

  const shutdown = async (): Promise<void> => {
    console.log("\nShutting down…");
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
  console.error(err);
  closePool().finally(() => process.exit(1));
});
