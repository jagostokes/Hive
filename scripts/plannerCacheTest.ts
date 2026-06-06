/**
 * Tests the planner and the semantic cache.
 *
 *  PLANNER (needs OPENROUTER_API_KEY): a multi-part question
 *  ("show me A, B, and the trend of C") must come back with A/B/C as INDEPENDENT
 *  sub-questions in the SAME first parallel group.
 *
 *  CACHE (needs DATABASE_URL too): store a question + SQL, then look up a
 *  near-duplicate phrasing and confirm it hits above threshold. Cleans up its row.
 *
 * Run: npm run test:planner-cache
 */
import "dotenv/config";
import { createContextProvider, type RawContext } from "../src/context/index.js";
import { runPlanner } from "../src/agents/index.js";
import { cacheLookup, cacheStore } from "../src/cache/index.js";
import { getPool, closePool } from "../src/db/index.js";

// Dummy ground truth so forPlanner() has a real schema + glossary to plan over.
const raw: RawContext = {
  schema: {
    tables: [
      {
        schema: "public",
        name: "orders",
        columns: [
          { name: "id", type: "int8", nullable: false },
          { name: "region", type: "text", nullable: true },
          { name: "status", type: "text", nullable: false },
          { name: "amount", type: "numeric", nullable: false },
          { name: "created_at", type: "timestamptz", nullable: true },
        ],
      },
    ],
  },
  glossary: [
    { id: 1, term: "revenue", definition: "Total money from orders.", sqlExpression: "sum(amount)" },
  ],
};

function section(title: string): void {
  console.log("\n" + "=".repeat(72) + "\n" + title + "\n" + "=".repeat(72));
}

async function testPlanner(): Promise<void> {
  section("PLANNER: multi-part question -> parallel group");
  const context = createContextProvider(raw);
  const question =
    "Show me total revenue by region, the number of orders by status, and the monthly trend of revenue.";
  console.log(`Question: ${question}\n`);

  const result = await runPlanner(question, { context });
  console.log("attempt trail:", result.attempts.map((a) => `#${a.index}[${a.role}]${a.ok ? "ok" : `fail(${a.reason})`}`).join("  "));

  if (!result.ok) {
    console.error("Planner failed gracefully:", result.reason);
    process.exitCode = 1;
    return;
  }

  const plan = result.data;
  console.log("\nsub-questions:");
  for (const n of plan.subQuestions) {
    console.log(`  ${n.id}: "${n.question}"  dependsOn=[${n.dependsOn.join(", ")}]`);
  }
  console.log("\nparallel groups (each inner array runs concurrently):");
  plan.groups.forEach((g, i) => console.log(`  group ${i}: [${g.join(", ")}]`));

  const firstGroup = plan.groups[0] ?? [];
  const independentCount = plan.subQuestions.filter((n) => n.dependsOn.length === 0).length;
  const pass = firstGroup.length >= 3 && independentCount >= 3;
  console.log(
    `\nCheck: ${independentCount} independent sub-questions, first parallel group has ` +
      `${firstGroup.length} -> ${pass ? "PASS (A/B/C parallelizable)" : "WARN (expected >=3 in parallel)"}`,
  );
  if (!pass) process.exitCode = 1;
}

async function testCache(): Promise<void> {
  section("CACHE: near-duplicate question -> hit");
  const original = "What is the total revenue for each region?";
  const nearDuplicate = "Show me total revenue broken down by region.";
  const unrelated = "How many distinct product categories are there?";
  const sql = "select region, sum(amount) as revenue from orders group by region";

  let storedId: number | null = null;
  try {
    storedId = await cacheStore(original, sql, { wasSuccessful: true });
    console.log(`Stored row #${storedId}: "${original}"`);

    const hit = await cacheLookup(nearDuplicate);
    console.log(`\nLookup near-duplicate: "${nearDuplicate}"`);
    if (hit.hit) {
      console.log(`  HIT  similarity=${hit.similarity.toFixed(4)}  cached="${hit.cachedQuestion}"`);
      console.log(`  reusable SQL: ${hit.sql}`);
    } else {
      console.log(`  MISS  bestSimilarity=${hit.bestSimilarity}`);
      process.exitCode = 1;
    }

    const miss = await cacheLookup(unrelated);
    console.log(`\nLookup unrelated: "${unrelated}"`);
    console.log(
      miss.hit
        ? `  HIT similarity=${miss.similarity.toFixed(4)} (unexpected)`
        : `  MISS bestSimilarity=${miss.bestSimilarity?.toFixed(4) ?? "n/a"} (expected)`,
    );
  } finally {
    if (storedId !== null) {
      await getPool().query("delete from query_cache where id = $1", [storedId]);
      console.log(`\nCleaned up row #${storedId}.`);
    }
  }
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.log("Skipping: set OPENROUTER_API_KEY in .env to run the planner/cache test.");
    return;
  }

  try {
    await testPlanner();

    if (process.env.DATABASE_URL) {
      await testCache();
    } else {
      section("CACHE skipped");
      console.log("Set DATABASE_URL in .env (and run `npm run db:setup`) to test the cache.");
    }
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error(err);
  closePool().finally(() => process.exit(1));
});
