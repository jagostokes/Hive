import "dotenv/config";
import { getPool, closePool } from "../src/db/index.js";
import { buildContext } from "../src/context/index.js";

async function main(): Promise<void> {
  const pool = getPool();
  const context = await buildContext(pool);
  const planner = context.forPlanner();
  // Mirror baseline's schemaBlock() exactly.
  const tables = planner.schema.tables
    .map((t) => `${t.schema}.${t.name}(${t.columns.map((c) => `${c.name} ${c.type}`).join(", ")})`)
    .join("\n");
  const glossary = planner.glossary
    .map((g) => `- ${g.term}: ${g.definition}${g.sqlExpression ? ` [${g.sqlExpression}]` : ""}`)
    .join("\n");
  console.log("=== What the BASELINE lane receives ===");
  console.log(`tables: ${planner.schema.tables.length}, glossary: ${planner.glossary.length}\n`);
  console.log(`Schema:\n${tables}\n\nGlossary:\n${glossary}`);
  await closePool();
}

main().catch((e) => {
  console.error(e);
  closePool().finally(() => process.exit(1));
});
