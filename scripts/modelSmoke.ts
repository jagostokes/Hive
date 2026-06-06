/**
 * Smoke test for the shared model client.
 *
 * Makes ONE cheap call through callModel(), prints the returned text, then prints
 * the resulting ledger entry with its computed cost and the run totals. This is
 * the source-of-truth check for the cost math — eyeball that costUsd matches
 * (promptTokens/1e6 * inPrice) + (completionTokens/1e6 * outPrice).
 *
 * Run: npm run smoke:model
 */
import "dotenv/config";
import { callModel, getLedger, getTotals, computeCostUsd } from "../src/models/index.js";
import { MODELS } from "../config/models.js";

// Use the cheapest chat role for a tiny, deterministic-ish call.
const ROLE = "sqlGen" as const;

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY is not set — copy .env.example to .env first.");
    process.exit(1);
  }

  const spec = MODELS[ROLE];
  console.log(`Calling role "${ROLE}" -> ${spec.slug}`);
  console.log(`Pricing: $${spec.inputPerMillion}/M in, $${spec.outputPerMillion}/M out\n`);

  const result = await callModel({
    role: ROLE,
    lane: "brain",
    temperature: 0,
    maxTokens: 32,
    messages: [
      { role: "system", content: "You are a terse assistant. Answer in one short sentence." },
      { role: "user", content: "Say hello and name one benefit of cheap LLMs." },
    ],
  });

  console.log("--- model text ---");
  console.log(result.text.trim() || "(empty)");
  console.log("\n--- usage ---");
  console.log(result.usage);

  const entry = getLedger().at(-1);
  console.log("\n--- ledger entry ---");
  console.log(JSON.stringify(entry, null, 2));

  if (entry) {
    const expected = computeCostUsd(entry.role, entry.promptTokens, entry.completionTokens);
    console.log(
      `\nCost check: ${entry.promptTokens}/1e6 * ${spec.inputPerMillion} + ` +
        `${entry.completionTokens}/1e6 * ${spec.outputPerMillion} = $${expected.toFixed(8)}`,
    );
    console.log(`Ledger costUsd matches recompute: ${entry.costUsd === expected}`);
  }

  console.log("\n--- run totals ---");
  console.log(JSON.stringify(getTotals(), null, 2));
}

main().catch((err) => {
  console.error("\nSmoke test failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
