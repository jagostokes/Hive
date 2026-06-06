import type { Pool } from "pg";
import { getPool } from "./client.js";
import type { ResultRow } from "../context/index.js";

export interface ReadOnlyResult {
  rows: ResultRow[];
  rowCount: number;
}

/**
 * Runs a single statement inside a READ ONLY transaction and returns its rows.
 * The transaction is always rolled back, so this can never mutate data — a write
 * or DDL statement raises a Postgres error instead. Used by agents to fetch the
 * rows for an already-verified query.
 */
export async function runReadOnlyQuery(
  sql: string,
  pool?: Pool,
): Promise<ReadOnlyResult> {
  const client = await (pool ?? getPool()).connect();
  try {
    await client.query("begin transaction read only");
    const result = await client.query(sql);
    await client.query("rollback").catch(() => {});
    const rows = (result.rows ?? []) as ResultRow[];
    return { rows, rowCount: result.rowCount ?? rows.length };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
