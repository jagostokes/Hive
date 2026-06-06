// agents/sqlAgent: turns a sub-question into a single verified read-only SQL
// query and its rows. Built on the reusable runner (cheap → retry → escalate →
// stop). This is the template the other agents follow.
import type { Pool } from "pg";
import { runAgent, type AgentResult, type AttemptFeedback } from "./runner.js";
import { sqlVerifier } from "../verifiers/index.js";
import { runReadOnlyQuery } from "../db/index.js";
import { callModel } from "../models/index.js";
import { escalationFor } from "../../config/models.js";
import type { ContextProvider, ResultRow, SqlContext } from "../context/index.js";

// This agent's single role. Sent as the system message — separate from the
// injected context, which goes in the user message.
const SYSTEM_PROMPT =
  "You write a single read-only SQL query for the given question using ONLY the " +
  "provided schema and glossary. Return SQL only.";

export interface SqlAgentDeps {
  context: ContextProvider;
  db: Pool;
  /** Reject results larger than this (passed to sqlVerifier). */
  maxRows?: number;
}

export interface SqlAgentSuccess {
  sql: string;
  rows: ResultRow[];
}

export type SqlAgentResult = AgentResult<string, SqlAgentSuccess>;

/**
 * Run the SQL sub-agent for one sub-question. Returns either
 * { ok:true, output:sql, data:{ sql, rows }, attempts } or a graceful
 * { ok:false, reason, attempts }. Always carries the full attempt trail.
 */
export async function runSqlAgent(
  subQuestion: string,
  deps: SqlAgentDeps,
): Promise<SqlAgentResult> {
  const scoped = deps.context.forSql(subQuestion);
  const maxRows = deps.maxRows;

  return runAgent<string, SqlAgentSuccess>({
    name: "sql",
    systemPrompt: SYSTEM_PROMPT,
    cheapRole: "sqlGen",
    escalationRole: escalationFor("sqlGen"),
    lane: "brain",
    temperature: 0,
    buildUserMessage: (feedback) => buildUserMessage(scoped, subQuestion, feedback),
    parse: extractSql,
    verify: async (sql) => {
      // Objective gate first (executes read-only, checks rows/cap/errors).
      const gate = await sqlVerifier(sql, deps.db, maxRows !== undefined ? { maxRows } : {});
      if (!gate.ok) return { ok: false, ...(gate.reason ? { reason: gate.reason } : {}) };
      // Verified: fetch the rows to return. Read-only, so it cannot mutate.
      const { rows } = await runReadOnlyQuery(sql, deps.db);
      return { ok: true, data: { sql, rows } };
    },
  });
}

// Build the USER message: this agent's scoped SQL context (relevant tables + the
// sql_expression glossary rows) + the sub-question. On a retry, append the prior
// SQL and the failure reason so the model can self-correct. No full context block.
function buildUserMessage(
  scoped: SqlContext,
  subQuestion: string,
  feedback: AttemptFeedback | null,
): string {
  const parts: string[] = [
    "Schema (only the relevant tables):",
    formatTables(scoped.tables),
    "",
    "Glossary (term -> SQL expression you may reuse):",
    formatGlossary(scoped.glossary),
    "",
    `Question: ${subQuestion}`,
  ];

  if (feedback) {
    parts.push(
      "",
      "Your previous query failed verification. Fix it.",
      `Previous SQL:\n${feedback.previousOutput.trim()}`,
      `Failure reason: ${feedback.reason}`,
    );
  }

  parts.push("", "Return the SQL query only, no prose, no code fences.");
  return parts.join("\n");
}

function formatTables(tables: SqlContext["tables"]): string {
  if (tables.length === 0) return "(none)";
  return tables
    .map((t) => {
      const cols = t.columns
        .map((c) => `${c.name} ${c.type}${c.nullable ? "" : " not null"}`)
        .join(", ");
      return `${t.schema}.${t.name}(${cols})`;
    })
    .join("\n");
}

function formatGlossary(glossary: SqlContext["glossary"]): string {
  if (glossary.length === 0) return "(none)";
  return glossary
    .map((g) => `- ${g.term}: ${g.sqlExpression} -- ${g.definition}`)
    .join("\n");
}

const ADAPT_SYSTEM_PROMPT =
  "You adapt an existing read-only SQL query to a new but similar question. " +
  "Reuse the original query's structure and only change what is necessary " +
  "(filters, selected columns, grouping, ordering, limits). Return SQL only.";

export interface AdaptCachedSqlDeps {
  db: Pool;
  /** Reject results larger than this (passed to sqlVerifier). */
  maxRows?: number;
}

export interface AdaptCachedSqlResult {
  ok: boolean;
  sql?: string;
  rows?: ResultRow[];
  reason?: string;
}

/**
 * SQL-skeleton reuse: adapt a near-matching cached query to a new sub-question
 * with a SINGLE cheap model call (role: sqlGen) instead of the full generate →
 * retry → escalate loop. The adapted SQL is still verified read-only; on any
 * failure the caller falls back to full generation.
 */
export async function adaptCachedSql(
  newQuestion: string,
  cachedQuestion: string,
  cachedSql: string,
  deps: AdaptCachedSqlDeps,
): Promise<AdaptCachedSqlResult> {
  const userMessage = [
    `Original question: ${cachedQuestion}`,
    "Original SQL:",
    cachedSql.trim(),
    "",
    `New question: ${newQuestion}`,
    "",
    "Return ONLY the adapted read-only SQL query. No prose, no code fences.",
  ].join("\n");

  let raw: string;
  try {
    const res = await callModel({
      role: "sqlGen",
      lane: "brain",
      temperature: 0,
      messages: [
        { role: "system", content: ADAPT_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });
    raw = res.text;
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  const sql = extractSql(raw);
  const gate = await sqlVerifier(sql, deps.db, deps.maxRows !== undefined ? { maxRows: deps.maxRows } : {});
  if (!gate.ok) return { ok: false, ...(gate.reason ? { reason: gate.reason } : {}) };

  const { rows } = await runReadOnlyQuery(sql, deps.db);
  return { ok: true, sql, rows };
}

// Cheap models often wrap SQL in ``` fences or prefix "sql". Strip that and take
// the statement so the verifier sees runnable SQL.
export function extractSql(raw: string): string {
  let text = raw.trim();

  const fence = text.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  // Drop a leading bare "sql" label if present.
  text = text.replace(/^\s*sql\s*[:\n]/i, "").trim();

  // Keep through the first statement terminator if the model emitted several.
  const semicolon = text.indexOf(";");
  if (semicolon !== -1) text = text.slice(0, semicolon + 1);

  return text.trim();
}
