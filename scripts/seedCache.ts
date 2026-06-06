/**
 * Pre-seed the semantic query cache with known-good question -> SQL pairs for the
 * demo schema (agent_demo_orders) so demo questions resolve instantly and
 * reliably. Each pair is embedded (text-embedding-3-small) and written to
 * query_cache, so a matching question hits the cache and reuses/adapts the SQL
 * instead of regenerating it — showing as a near-zero-cost entry in the
 * comparison counter.
 *
 *   npm run seed:cache
 *
 * Idempotent: re-running first removes any prior rows with the same question
 * text, then re-inserts. Requires OPENROUTER_API_KEY + DATABASE_URL.
 */
import "dotenv/config";
import { getPool, closePool } from "../src/db/index.js";
import { cacheStore } from "../src/cache/index.js";

const TABLE = "agent_demo_orders";

// Known-good pairs for the demo schema:
//   agent_demo_orders(id, region, status, amount numeric, created_at timestamptz)
const PAIRS: { question: string; sql: string }[] = [
  {
    question: "What is total revenue by region?",
    sql: `select region, sum(amount) as revenue from ${TABLE} group by region order by revenue desc`,
  },
  {
    question: "How many orders are there by status?",
    sql: `select status, count(*) as order_count from ${TABLE} group by status order by order_count desc`,
  },
  {
    question: "What is the monthly trend of revenue?",
    sql: `select date_trunc('month', created_at) as month, sum(amount) as revenue from ${TABLE} group by 1 order by 1`,
  },
  {
    question: "What is the total revenue across all orders?",
    sql: `select sum(amount) as total_revenue from ${TABLE}`,
  },
  {
    question: "What is the average order amount?",
    sql: `select round(avg(amount), 2) as avg_amount from ${TABLE}`,
  },
  {
    question: "Which region has the highest revenue?",
    sql: `select region, sum(amount) as revenue from ${TABLE} group by region order by revenue desc limit 1`,
  },
  {
    question: "What has been my largest month in sales?",
    sql: `select date_trunc('month', created_at) as month, sum(amount) as revenue from ${TABLE} group by 1 order by revenue desc limit 1`,
  },
  {
    question: "How many paid orders are there?",
    sql: `select count(*) as paid_orders from ${TABLE} where status = 'paid'`,
  },
  {
    question: "What is the revenue by order status?",
    sql: `select status, sum(amount) as revenue from ${TABLE} group by status order by revenue desc`,
  },
  {
    question: "What is the number of orders per region?",
    sql: `select region, count(*) as order_count from ${TABLE} group by region order by order_count desc`,
  },
  {
    question: "What is the total refunded amount?",
    sql: `select coalesce(sum(amount), 0) as refunded_amount from ${TABLE} where status = 'refunded'`,
  },
  {
    question: "What are the monthly order counts?",
    sql: `select date_trunc('month', created_at) as month, count(*) as order_count from ${TABLE} group by 1 order by 1`,
  },
];

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY || !process.env.DATABASE_URL) {
    console.error("Set OPENROUTER_API_KEY and DATABASE_URL in .env first.");
    process.exit(1);
  }

  const pool = getPool();

  // Idempotent: clear any prior rows for these exact questions before re-seeding.
  const questions = PAIRS.map((p) => p.question);
  await pool.query(`delete from query_cache where question_text = any($1::text[])`, [questions]);

  console.log(`Seeding ${PAIRS.length} question -> SQL pairs into query_cache…\n`);
  let n = 0;
  for (const { question, sql } of PAIRS) {
    const id = await cacheStore(question, sql, { pool });
    n++;
    console.log(`  [${String(n).padStart(2, " ")}] #${id}  ${question}`);
  }

  console.log(`\nDone. ${n} pairs cached. Run \`npm run compare -- "<a seeded question>"\` to see a near-instant, near-zero-cost cache hit.`);
  await closePool();
}

main().catch((err) => {
  console.error(err);
  closePool().finally(() => process.exit(1));
});
