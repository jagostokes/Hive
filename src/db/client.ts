import "dotenv/config";
import { Pool } from "pg";

// Two logical connections, both plain Postgres (any provider):
//   - APP pool  (DATABASE_URL):      Hive's own brain-state tables — query_cache,
//                                    business_glossary, prompt_versions,
//                                    learned_examples, synthesized_verifiers,
//                                    training_runs/metrics. pgvector lives here.
//   - DATA pool (DATA_DATABASE_URL): the analytics database the questions run
//                                    against (e.g. Northwind on ClickHouse Cloud's
//                                    Postgres). Introspected + queried, never
//                                    written to.
// DATA_DATABASE_URL falls back to DATABASE_URL, so a single-database setup keeps
// working unchanged.
let appPool: Pool | null = null;
let dataPool: Pool | null = null;

// Hosted Postgres (Neon, ClickHouse Cloud, etc.) requires TLS. node-postgres
// needs ssl set explicitly when the URL asks for it.
function sslFor(connectionString: string): { rejectUnauthorized: boolean } | undefined {
  return /sslmode=(require|verify)/.test(connectionString)
    ? { rejectUnauthorized: false }
    : undefined;
}

/** Pool for Hive's own brain-state tables (DATABASE_URL). */
export function getPool(): Pool {
  if (appPool) return appPool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and fill in the Postgres connection string.",
    );
  }

  appPool = new Pool({ connectionString, ssl: sslFor(connectionString) });
  return appPool;
}

/**
 * Pool for the analytics data the questions run against (DATA_DATABASE_URL).
 * Falls back to DATABASE_URL when unset so single-database setups still work.
 * When the two URLs differ, returns a distinct pool.
 */
export function getDataPool(): Pool {
  const dataUrl = process.env.DATA_DATABASE_URL;
  // No separate data URL configured → analytics and app share one database.
  if (!dataUrl || dataUrl === process.env.DATABASE_URL) return getPool();

  if (dataPool) return dataPool;
  dataPool = new Pool({ connectionString: dataUrl, ssl: sslFor(dataUrl) });
  return dataPool;
}

export async function closePool(): Promise<void> {
  // Null the handle BEFORE awaiting so a concurrent/second call (e.g. SIGINT +
  // SIGTERM, or a double Ctrl+C) doesn't call pool.end() twice — which throws
  // "Called end on pool more than once".
  const a = appPool;
  const d = dataPool;
  appPool = null;
  dataPool = null;
  if (a) await a.end();
  if (d && d !== a) await d.end();
}
