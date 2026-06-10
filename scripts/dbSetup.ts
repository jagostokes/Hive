// Run schema.sql against DATABASE_URL. Replaces the old InsForge CLI command.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, closePool } from "../src/db/client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(resolve(__dirname, "../src/db/schema.sql"), "utf-8");

async function main(): Promise<void> {
  const pool = getPool();
  console.log("Running schema.sql …");
  await pool.query(sql);
  console.log("Done.");
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
