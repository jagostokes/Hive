/**
 * Interactive comparison demo: serves the brain-vs-baseline comparison page on
 * localhost against the REAL imported dataset (live schema introspection — no
 * generated/seeded test table), and stays up so you can open it in a browser and
 * watch the live token/cost counters and both dashboards render side by side.
 *
 *   npm run compare -- "Show me total revenue by region and orders by status"
 *
 * Ctrl+C to stop (cleans up the cache rows this run created).
 * Requires OPENROUTER_API_KEY + DATABASE_URL.
 */
import "dotenv/config";
import { getPool, closePool } from "../src/db/index.js";
import { buildContext } from "../src/context/index.js";
import { serveComparison } from "../src/web/index.js";

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY || !process.env.DATABASE_URL) {
    console.error("Set OPENROUTER_API_KEY and DATABASE_URL in .env first.");
    process.exit(1);
  }

  const question =
    process.argv.slice(2).join(" ").trim() ||
    "Show me total revenue by region, the number of orders by status, and the monthly trend of revenue.";

  const cacheCutoff = new Date();
  // Real dataset: introspect the live schema + glossary. No seeded test table.
  const context = await buildContext(getPool());
  const server = await serveComparison(question, { context, db: getPool(), port: 0 });

  console.log(`\n  Hive comparison running at:  ${server.url}`);
  console.log(`  Question: ${question}`);
  console.log(`  Open the URL in your browser. Ctrl+C to stop.\n`);

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return; // ignore a second Ctrl+C / SIGTERM
    closing = true;
    console.log("\nShutting down…");
    await server.close().catch(() => {});
    await getPool().query(`delete from query_cache where created_at >= $1`, [cacheCutoff]).catch(() => {});
    await closePool().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  closePool().finally(() => process.exit(1));
});
