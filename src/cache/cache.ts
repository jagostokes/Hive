// cache: semantic lookup over the query_cache table. Embed the incoming question
// and cosine-search pgvector for a near-duplicate above a threshold; on a hit,
// the cached SQL can be reused/adapted instead of regenerating it. Also writes
// successful (question -> SQL) pairs back for future hits.
import type { Pool } from "pg";
import { getPool } from "../db/index.js";
import { embed, type Lane } from "../models/index.js";

// Cosine similarity (1 - distance) at or above this counts as a usable match.
// pgvector's <=> is cosine distance in [0,2]; identical text ~= 1.0 similarity.
// Tuned for text-embedding-3-small, where same-intent paraphrases score ~0.8-0.92
// and unrelated questions sit ~0.3 — 0.78 separates them with margin. Reused SQL
// is re-verified downstream, so a borderline hit is not unsafe.
export const DEFAULT_SIMILARITY_THRESHOLD = 0.78;

export interface CacheHit {
  hit: true;
  id: number;
  sql: string;
  cachedQuestion: string;
  similarity: number;
}

export interface CacheMiss {
  hit: false;
  /** Best similarity seen (if any rows existed), for observability. */
  bestSimilarity: number | null;
}

export type CacheResult = CacheHit | CacheMiss;

export interface CacheLookupOptions {
  threshold?: number;
  pool?: Pool;
  lane?: Lane;
}

// pgvector accepts a vector literal like '[0.1,0.2,...]'.
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

interface CacheRow {
  id: string | number;
  question_text: string;
  generated_sql: string | null;
  similarity: number | string;
}

/**
 * Embed `question` and return the single nearest cached row. A hit requires a
 * successful, non-null SQL whose cosine similarity meets the threshold.
 */
export async function cacheLookup(
  question: string,
  opts: CacheLookupOptions = {},
): Promise<CacheResult> {
  const pool = opts.pool ?? getPool();
  const threshold = opts.threshold ?? DEFAULT_SIMILARITY_THRESHOLD;

  const { embedding } = await embed(question, { lane: opts.lane });
  const vec = toVectorLiteral(embedding);

  const { rows } = await pool.query<CacheRow>(
    `select id,
            question_text,
            generated_sql,
            1 - (question_embedding <=> $1::vector) as similarity
       from query_cache
      where question_embedding is not null
        and was_successful is true
        and generated_sql is not null
      order by question_embedding <=> $1::vector
      limit 1`,
    [vec],
  );

  const top = rows[0];
  if (!top) return { hit: false, bestSimilarity: null };

  const similarity = Number(top.similarity);
  if (similarity >= threshold && top.generated_sql) {
    return {
      hit: true,
      id: Number(top.id),
      sql: top.generated_sql,
      cachedQuestion: top.question_text,
      similarity,
    };
  }
  return { hit: false, bestSimilarity: similarity };
}

export interface CacheStoreOptions {
  pool?: Pool;
  lane?: Lane;
  wasSuccessful?: boolean;
}

/**
 * Embed `question` and persist the (question, embedding, SQL) row so future
 * near-duplicates hit the cache. Returns the new row id.
 */
export async function cacheStore(
  question: string,
  sql: string,
  opts: CacheStoreOptions = {},
): Promise<number> {
  const pool = opts.pool ?? getPool();
  const { embedding } = await embed(question, { lane: opts.lane });
  const vec = toVectorLiteral(embedding);

  const { rows } = await pool.query<{ id: string | number }>(
    `insert into query_cache (question_text, question_embedding, generated_sql, was_successful)
     values ($1, $2::vector, $3, $4)
     returning id`,
    [question, vec, sql, opts.wasSuccessful ?? true],
  );
  return Number(rows[0].id);
}
