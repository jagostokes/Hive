import type { Pool } from "pg";
import { getPool } from "./client.js";
import type { ResultRow } from "../context/index.js";

export interface ReadOnlyResult {
  rows: ResultRow[];
  rowCount: number;
}

// Transient Postgres/connection error classes worth retrying. The big one is
// 42P01 (undefined_table): on managed/pooled Postgres a read issued moments
// after the table is created can land on a backend that hasn't seen the new
// relation yet, so the SAME valid SQL fails once then succeeds. Connection-level
// classes (08*) and transaction conflicts (40001/40P01) are also momentary.
const TRANSIENT_PG_CODES = new Set([
  "42P01", // undefined_table — usually propagation lag right after DDL
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "08000", // connection_exception
  "08003", // connection_does_not_exist
  "08006", // connection_failure
  "57P01", // admin_shutdown
  "53300", // too_many_connections
]);

const MAX_QUERY_ATTEMPTS = 4;

function isTransient(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return typeof code === "string" && TRANSIENT_PG_CODES.has(code);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Runs a single statement inside a READ ONLY transaction and returns its rows.
 * The transaction is always rolled back, so this can never mutate data — a write
 * or DDL statement raises a Postgres error instead. Used by agents to fetch the
 * rows for an already-verified query.
 *
 * Transient errors (table not yet visible after a fresh create, connection
 * blips) are retried a few times with backoff so a momentary DB hiccup doesn't
 * sink an otherwise-valid query. A genuinely bad query (e.g. a truly missing
 * table) still ends up throwing after the retries are exhausted.
 */
export async function runReadOnlyQuery(
  sql: string,
  pool?: Pool,
): Promise<ReadOnlyResult> {
  const resolved = pool ?? getPool();
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_QUERY_ATTEMPTS; attempt++) {
    const client = await resolved.connect();
    try {
      await client.query("begin transaction read only");
      const result = await client.query(sql);
      await client.query("rollback").catch(() => {});
      const rows = (result.rows ?? []) as ResultRow[];
      return { rows, rowCount: result.rowCount ?? rows.length };
    } catch (err) {
      await client.query("rollback").catch(() => {});
      lastErr = err;
      if (attempt < MAX_QUERY_ATTEMPTS && isTransient(err)) {
        await sleep(250 * attempt);
        continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
  throw lastErr;
}
