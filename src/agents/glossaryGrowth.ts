// agents/glossaryGrowth: when the SQL agent encounters an unknown business term,
// the researcher agent profiles the data to infer a definition and optional
// sql_expression, then inserts a new row into `business_glossary`. Future runs
// benefit automatically because the context provider reads the glossary at start.
//
// The researcher runs on the insight model (cheap) and does NOT go through the
// runner template — it's a one-shot meta-agent.
import type { Pool } from "pg";
import { callModel } from "../models/index.js";
// GlossaryEntry shape is used by the context provider; we insert raw SQL here.

export interface ResearchInput {
  /** The unknown term the SQL agent couldn't map. */
  term: string;
  /** Compact schema description (from the context provider's forPlanner). */
  schema: string;
  /** The original question or sub-question that surfaced the term. */
  question: string;
}

export interface ResearchResult {
  term: string;
  definition: string;
  sqlExpression: string | null;
}

const RESEARCHER_SYSTEM =
  "You are a data researcher. Given an unknown business term, a database schema, " +
  "and the question that surfaced the term, infer what the term means based on the " +
  "schema's table and column names. If you can map the term to a concrete SQL " +
  "expression (e.g. a column, a CASE expression, a JOIN pattern), provide it. " +
  "Return ONLY this JSON:\n" +
  '{"term": "the term", "definition": "plain-English definition", ' +
  '"sqlExpression": "SQL fragment or null if you cannot determine one"}';

/**
 * Research an unknown term by examining the schema. One cheap model call.
 */
export async function researchTerm(input: ResearchInput): Promise<ResearchResult> {
  const userMessage = [
    `Unknown term: "${input.term}"`,
    "",
    "Database schema:",
    input.schema,
    "",
    `Question context: ${input.question}`,
    "",
    "Infer the meaning from the schema. Return ONLY the JSON.",
  ].join("\n");

  const res = await callModel({
    role: "insight", // cheap model
    lane: "brain",
    temperature: 0,
    messages: [
      { role: "system", content: RESEARCHER_SYSTEM },
      { role: "user", content: userMessage },
    ],
  });

  const text = res.text.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Researcher returned non-JSON: ${text.slice(0, 200)}`);
  }
  const parsed = JSON.parse(jsonMatch[0]) as {
    term?: string;
    definition?: string;
    sqlExpression?: string | null;
  };
  if (!parsed.term || !parsed.definition) {
    throw new Error("Researcher JSON missing term or definition");
  }
  return {
    term: parsed.term,
    definition: parsed.definition,
    sqlExpression: parsed.sqlExpression ?? null,
  };
}

/**
 * Check if a term already exists in the glossary (case-insensitive).
 */
export async function glossaryHasTerm(pool: Pool, term: string): Promise<boolean> {
  const { rows } = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM business_glossary WHERE LOWER(term) = LOWER($1)`,
    [term],
  );
  return Number(rows[0].cnt) > 0;
}

/**
 * Insert a new auto-researched glossary entry. Returns the new row's id.
 */
export async function insertGlossaryEntry(
  pool: Pool,
  entry: ResearchResult,
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO business_glossary (term, definition, sql_expression, source)
     VALUES ($1, $2, $3, 'auto-research')
     RETURNING id`,
    [entry.term, entry.definition, entry.sqlExpression],
  );
  return Number(rows[0].id);
}

/**
 * Full glossary growth flow: research → check duplicate → insert.
 * Returns the research result + whether it was actually inserted (skipped if duplicate).
 */
export async function growGlossary(
  pool: Pool,
  input: ResearchInput,
): Promise<ResearchResult & { inserted: boolean; glossaryId?: number }> {
  const result = await researchTerm(input);

  if (await glossaryHasTerm(pool, result.term)) {
    return { ...result, inserted: false };
  }

  const glossaryId = await insertGlossaryEntry(pool, result);
  return { ...result, inserted: true, glossaryId };
}

/**
 * Detect potentially unknown terms in a question by comparing against the
 * existing glossary. Returns terms present in the question but NOT in the
 * glossary. Simple heuristic: split on whitespace, lowercase, check each
 * multi-word n-gram (up to 3) against the glossary.
 */
export async function detectUnknownTerms(
  pool: Pool,
  question: string,
): Promise<string[]> {
  // Load all known terms.
  const { rows } = await pool.query<{ term: string }>(
    `SELECT LOWER(term) AS term FROM business_glossary`,
  );
  const known = new Set(rows.map((r) => r.term));

  // Build candidate terms: 1-gram, 2-gram, 3-gram.
  const words = question.toLowerCase().split(/\s+/).filter(Boolean);
  const candidates: string[] = [];
  for (let n = 1; n <= Math.min(3, words.length); n++) {
    for (let i = 0; i <= words.length - n; i++) {
      candidates.push(words.slice(i, i + n).join(" "));
    }
  }

  // Filter to domain-looking terms not in the glossary.
  // Skip very short tokens and common English stop words.
  const STOP = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "shall",
    "should", "may", "might", "must", "can", "could", "of", "in", "to",
    "for", "with", "on", "at", "by", "from", "as", "into", "through",
    "during", "before", "after", "and", "but", "or", "nor", "not", "no",
    "so", "if", "then", "than", "too", "very", "just", "about", "above",
    "below", "between", "each", "every", "all", "both", "few", "more",
    "most", "other", "some", "such", "only", "own", "same", "what",
    "which", "who", "whom", "this", "that", "these", "those", "how",
    "when", "where", "why", "total", "average", "count", "sum", "per",
    "over", "last", "first", "top", "bottom", "highest", "lowest",
    "many", "much", "number", "amount",
  ]);

  const unknown: string[] = [];
  for (const c of candidates) {
    if (c.length < 3) continue;
    if (STOP.has(c)) continue;
    if (known.has(c)) continue;
    // Only keep multi-word or capitalized-looking terms (more likely domain terms).
    if (c.split(" ").length === 1 && STOP.has(c)) continue;
    unknown.push(c);
  }

  // Deduplicate, prefer longer n-grams.
  const deduped: string[] = [];
  const seen = new Set<string>();
  // Sort by length desc so longer terms take priority.
  unknown.sort((a, b) => b.length - a.length);
  for (const t of unknown) {
    if (seen.has(t)) continue;
    // If a shorter term is a substring of an already-added longer term, skip it.
    let subsumed = false;
    for (const added of deduped) {
      if (added.includes(t)) { subsumed = true; break; }
    }
    if (subsumed) continue;
    deduped.push(t);
    seen.add(t);
  }

  return deduped;
}

/**
 * Store a learned example (cheap agent failure + escalation success) for the
 * apprentice-master pattern. Future runs can inject these as few-shot examples.
 */
export async function storeLearnedExample(
  pool: Pool,
  role: string,
  subQuestion: string,
  badOutput: string,
  goodOutput: string,
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO learned_examples (role, sub_question, bad_output, good_output)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [role, subQuestion, badOutput, goodOutput],
  );
  return Number(rows[0].id);
}

/**
 * Load recent learned examples for a role (most recent first, capped).
 */
export async function loadLearnedExamples(
  pool: Pool,
  role: string,
  limit: number = 3,
): Promise<Array<{ subQuestion: string; badOutput: string; goodOutput: string }>> {
  const { rows } = await pool.query<{
    sub_question: string;
    bad_output: string;
    good_output: string;
  }>(
    `SELECT sub_question, bad_output, good_output
     FROM learned_examples
     WHERE role = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [role, limit],
  );
  return rows.map((r) => ({
    subQuestion: r.sub_question,
    badOutput: r.bad_output,
    goodOutput: r.good_output,
  }));
}
