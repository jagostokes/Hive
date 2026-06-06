import "dotenv/config";
import { Pool } from "pg";

// Shared lazily-created connection pool to InsForge Postgres.
let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and fill in the InsForge connection string (npx @insforge/cli db connection-string).",
    );
  }

  // InsForge requires TLS (sslmode=require in the URL). node-postgres needs ssl
  // set explicitly; the managed cert is not in the local trust store.
  const ssl = /sslmode=(require|verify)/.test(connectionString)
    ? { rejectUnauthorized: false }
    : undefined;

  pool = new Pool({ connectionString, ssl });
  return pool;
}

export async function closePool(): Promise<void> {
  // Null the handle BEFORE awaiting so a concurrent/second call (e.g. SIGINT +
  // SIGTERM, or a double Ctrl+C) doesn't call pool.end() twice — which throws
  // "Called end on pool more than once".
  const p = pool;
  pool = null;
  if (p) await p.end();
}
