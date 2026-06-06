/**
 * Prompt 9 checkpoint: pre-seed + SQL-skeleton reuse.
 *
 * Proves that:
 *  1. A pre-seeded question is found in the cache (high cosine similarity).
 *  2. An EXACT-ish match reuses the cached SQL verbatim — zero SQL-generation
 *     cost (only a tiny embedding for the lookup).
 *  3. A looser paraphrase ADAPTS the cached SQL with a single cheap call
 *     (skeleton reuse) instead of full regeneration.
 *  4. End to end, runBrainLane reports cacheHits >= 1 and the cached lane's SQL
 *     step contributes ~zero cost.
 *
 *   npm run test:cache-reuse
 *
 * Requires OPENROUTER_API_KEY + DATABASE_URL (with pgvector + query_cache).
 */
import "dotenv/config";
import { getPool, closePool } from "../src/db/index.js";
import { createContextProvider, type RawContext } from "../src/context/index.js";
import { cacheLookup, cacheStore } from "../src/cache/index.js";
import { adaptCachedSql } from "../src/agents/index.js";
import { runBrainLane } from "../src/orchestrator/index.js";
import { getLedger } from "../src/models/index.js";

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

const SEED_QUESTION = "What is total revenue by region?";
const SEED_SQL = `select region, sum(amount) as revenue from ${TABLE} group by region order by revenue desc`;

async function seedTable(): Promise<void> {
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

function sqlGenCost(): number {
  return getLedger()
    .filter((e) => e.role === "sqlGen" || e.role === "sqlEscalation")
    .reduce((s, e) => s + e.costUsd, 0);
}

let pass = true;
function check(label: string, cond: boolean, detail = ""): void {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) pass = false;
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY || !process.env.DATABASE_URL) {
    console.error("Set OPENROUTER_API_KEY and DATABASE_URL in .env first.");
    process.exit(1);
  }

  const pool = getPool();
  const context = createContextProvider(raw);

  await seedTable();
  // Clean any prior copy of the seed question, then pre-seed exactly one pair.
  await pool.query(`delete from query_cache where question_text = $1`, [SEED_QUESTION]);
  const seededId = await cacheStore(SEED_QUESTION, SEED_SQL, { pool });
  console.log(`Pre-seeded cache row #${seededId}: "${SEED_QUESTION}"\n`);

  try {
    // 1. Exact-ish lookup hits with high similarity.
    console.log("1) Cache lookup (near-exact):");
    const hit = await cacheLookup(SEED_QUESTION, { pool });
    check("lookup is a hit", hit.hit);
    if (hit.hit) {
      check("similarity >= 0.93 (verbatim-reuse tier)", hit.similarity >= 0.93, hit.similarity.toFixed(4));
    }

    // 2. Paraphrase adapts the cached skeleton with one cheap call.
    console.log("\n2) Skeleton reuse (adapt a paraphrase):");
    const paraphrase = "Break down the total sales amount for each region";
    const adapted = await adaptCachedSql(paraphrase, SEED_QUESTION, SEED_SQL, { db: pool });
    check("adaptation succeeded", adapted.ok, adapted.reason ?? "");
    check("adapted query returned rows", Boolean(adapted.rows && adapted.rows.length > 0));
    if (adapted.sql) console.log(`     adapted SQL: ${adapted.sql.replace(/\s+/g, " ").trim()}`);

    // 3. End to end: brain lane should serve this question from cache.
    console.log("\n3) runBrainLane on the seeded question:");
    const t0 = Date.now();
    const r = await runBrainLane(SEED_QUESTION, { context, db: pool, serve: false });
    const ms = Date.now() - t0;
    check("brain lane ok", r.ok, r.reason ?? "");
    check("reported >= 1 cache hit", r.cacheHits >= 1, `cacheHits=${r.cacheHits}`);
    const cachedLanes = r.lanes.filter(
      (l) => l.sqlSource === "cache" || l.sqlSource === "cache-adapted",
    );
    check("at least one lane used cache/cache-adapted", cachedLanes.length > 0);
    const genCost = sqlGenCost();
    check("SQL-generation cost is ~zero for the cached path", genCost < 0.0005, `$${genCost.toFixed(6)}`);

    console.log(
      `\n  lanes: ${r.lanes
        .map((l) => `${l.id}[${l.sqlSource}${l.cacheSimilarity ? ` ${l.cacheSimilarity.toFixed(2)}` : ""}]`)
        .join(", ")}`,
    );
    console.log(`  brain total cost: $${r.totals.byLane.brain.costUsd.toFixed(6)} | wall: ${ms}ms`);
  } finally {
    await pool.query(`delete from query_cache where question_text = $1`, [SEED_QUESTION]).catch(() => {});
    await pool.query(`drop table if exists ${TABLE}`).catch(() => {});
    await closePool();
  }

  console.log(`\n${pass ? "PASS" : "FAIL"} — cache pre-seed + skeleton reuse`);
  if (!pass) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  closePool().finally(() => process.exit(1));
});
