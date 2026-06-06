import "dotenv/config";
import { getPool, closePool } from "../src/db/index.js";
import { buildContext } from "../src/context/index.js";
import { runPlanner } from "../src/agents/index.js";

const Q =
  "compare my sales from the first month of 2017 to the first month of 2018, and in what categories i sold the most";

async function main(): Promise<void> {
  const pool = getPool();
  const context = await buildContext(pool);
  const r = await runPlanner(Q, { context });
  if (!r.ok) {
    console.log("planner failed:", r.reason);
  } else {
    console.log(`groups: ${JSON.stringify(r.data.groups)}`);
    for (const n of r.data.subQuestions) {
      console.log(`  ${n.id} (deps=${JSON.stringify(n.dependsOn)}): ${n.question}`);
    }
  }
  await closePool();
}

main().catch((e) => {
  console.error(e);
  closePool().finally(() => process.exit(1));
});
