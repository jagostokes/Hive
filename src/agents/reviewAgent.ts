// agents/reviewAgent: a training-time LLM-as-judge that critiques SQL the
// objective verifier already ACCEPTED. The verifier only proves a query ran and
// returned a plausibly-shaped result — it cannot tell whether the query answers
// the question correctly (right join grain, the GROUP BY the question implies,
// a missing date filter, an ignored "per X" clause, an inefficient pattern).
//
// The reviewer reads the question + generated SQL + a sample of the rows and
// returns a quality score with concrete issues. When the score is low, the
// training loop fires the existing prompt surgeon using the reviewer's critique
// as the rejection reason — so the system prompt evolves on QUALITY, not just on
// catastrophic failure. This is what makes the prompt-evolution dashboard light
// up even on a run where every query "passes".
//
// It runs on the `reviewer` model (a heftier judge) and only at training time —
// never in the live, cost-compared brain lane.
import { callModel } from "../models/index.js";
import { extractJsonObject } from "./parse.js";
import type { ResultRow } from "../context/index.js";

export interface ReviewInput {
  /** The natural-language sub-question the SQL was meant to answer. */
  question: string;
  /** The generated SQL that the objective verifier accepted. */
  sql: string;
  /** The rows the SQL returned (a sample is sent to the judge). */
  rows: ResultRow[];
  /** Compact schema string (table(col, col); ...) for grounding the judgment. */
  schema?: string;
}

export interface ReviewResult {
  /** Quality score in [0, 1]. 1 = fully answers the question, well-shaped. */
  score: number;
  /** Short category tags for the problems found (e.g. "missing-date-filter"). */
  issues: string[];
  /** The judge's own recommendation that the prompt should be revised. */
  shouldRevise: boolean;
  /** One- or two-sentence root-cause critique, fed to the surgeon. */
  critique: string;
}

const REVIEWER_SYSTEM =
  "You are a senior analytics engineer doing code review on SQL an agent " +
  "generated to answer a business question. The query already executed and " +
  "returned rows — you are NOT checking that it runs. You are judging whether it " +
  "actually and correctly ANSWERS the question. Grade against this rubric:\n" +
  "1. Intent match — does it answer what was asked (all parts, the right entity, " +
  "the right 'per X' grain)?\n" +
  "2. Join grain — are joins at the correct granularity (no fan-out double " +
  "counting, no missing join)?\n" +
  "3. Aggregation — correct GROUP BY / aggregate for what was asked?\n" +
  "4. Filters — are implied filters present (date ranges, status, " +
  "non-discontinued, etc.)?\n" +
  "5. Shape & efficiency — sensible columns, ordering, limits; no needless " +
  "complexity or raw row dumps.\n" +
  "Score 1.0 = correct and well-formed. Score 0.7-0.9 = correct but with minor " +
  "weaknesses. Score < 0.7 = a real correctness problem that should change the " +
  "agent's system prompt. Be a fair but exacting reviewer — do not invent " +
  "problems, but do not rubber-stamp a query that quietly answers the wrong " +
  "question. `issues` must be short kebab-case tags (e.g. \"missing-date-filter\", " +
  "\"wrong-join-grain\", \"ignored-per-customer\"). Return ONLY this JSON shape:\n" +
  '{"score": 0.0, "issues": ["tag"], "shouldRevise": false, ' +
  '"critique": "one-sentence root cause aimed at the system prompt"}';

function sampleRows(rows: ResultRow[], limit = 15): ResultRow[] {
  return rows.slice(0, limit);
}

/**
 * Run the reviewer over an accepted SQL result. One-shot, no retry loop — it is
 * a meta-agent like the surgeon. Returns a clamped, validated ReviewResult.
 */
export async function runReviewAgent(input: ReviewInput): Promise<ReviewResult> {
  const rowsSample = sampleRows(input.rows);
  const userMessage = [
    `Question: ${input.question}`,
    "",
    ...(input.schema ? ["Schema:", input.schema, ""] : []),
    "Generated SQL:",
    input.sql,
    "",
    `Rows returned (${input.rows.length} total, showing up to ${rowsSample.length}):`,
    JSON.stringify(rowsSample),
    "",
    "Review the SQL against the rubric and return ONLY the JSON.",
  ].join("\n");

  const res = await callModel({
    role: "reviewer",
    lane: "brain",
    temperature: 0,
    messages: [
      { role: "system", content: REVIEWER_SYSTEM },
      { role: "user", content: userMessage },
    ],
  });

  const parsed = extractJsonObject(res.text) as {
    score?: unknown;
    issues?: unknown;
    shouldRevise?: unknown;
    critique?: unknown;
  };

  const rawScore = typeof parsed.score === "number" ? parsed.score : 1;
  const score = Math.max(0, Math.min(1, rawScore));
  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.filter((t): t is string => typeof t === "string")
    : [];
  const critique =
    typeof parsed.critique === "string" && parsed.critique.trim().length > 0
      ? parsed.critique.trim()
      : "Query answers the question only partially.";
  const shouldRevise =
    typeof parsed.shouldRevise === "boolean" ? parsed.shouldRevise : score < 0.8;

  return { score, issues, shouldRevise, critique };
}
