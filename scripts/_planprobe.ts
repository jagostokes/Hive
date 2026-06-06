import "dotenv/config";
import { createContextProvider, type RawContext } from "../src/context/index.js";
import { runPlanner } from "../src/agents/index.js";
import { closePool } from "../src/db/index.js";

const TABLE = "agent_demo_orders";
const raw: RawContext = {
  schema: { tables: [{ schema: "public", name: TABLE, columns: [
    { name: "id", type: "int8", nullable: false },
    { name: "region", type: "text", nullable: false },
    { name: "status", type: "text", nullable: false },
    { name: "amount", type: "numeric", nullable: false },
    { name: "created_at", type: "timestamptz", nullable: true },
  ] }] },
  glossary: [{ id: 1, term: "revenue", definition: "Total money (sum of amount).", sqlExpression: "sum(amount)" }],
};
const Q = "What is the average order value for each region, what percentage of total revenue does each region contribute, and which region has the highest average order amount?";

async function main(): Promise<void> {
  const context = createContextProvider(raw);
  for (let i = 1; i <= 4; i++) {
    const r = await runPlanner(Q, { context });
    console.log(`\n=== planner run ${i}: ok=${r.ok} ===`);
    if (r.ok) {
      console.log("subQuestions:", JSON.stringify(r.data.subQuestions, null, 2));
      console.log("groups:", JSON.stringify(r.data.groups));
    } else {
      console.log("reason:", r.reason);
      r.attempts.forEach((a) => console.log(`  attempt ${a.index} (${a.model}) ok=${a.ok} reason=${a.reason}\n  raw: ${a.rawOutput.slice(0, 400)}`));
    }
  }
  await closePool();
}
main().catch((e) => { console.error(e); closePool().finally(() => process.exit(1)); });
