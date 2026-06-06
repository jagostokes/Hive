// baseline: the single STRONG-model lane. One agent loop on the `baseline` model
// does the WHOLE task — it runs read-only SQL via a tool, sees the results, and
// writes the same self-contained React dashboard from the SAME question against
// the SAME database. No decomposition, no cheap models. Every call is tagged
// lane:"baseline" so the ledger can compare it against the brain lane.
import "dotenv/config";
import type { Pool } from "pg";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { callModel } from "../models/index.js";
import { getPool, runReadOnlyQuery } from "../db/index.js";
import { renderVerifier } from "../verifiers/index.js";
import { stripCodeFence } from "../agents/index.js";
import { buildContext, type ContextProvider, type PlannerContext } from "../context/index.js";
import { buildDashboardHtml } from "../web/dashboardHost.js";
import { DASHBOARD_DESIGN_BRIEF } from "../web/designBrief.js";
import { MODELS } from "../../config/models.js";

// Capped loop (standing constraint): bound the tool/turn iterations.
const MAX_ITERATIONS = 8;
const MAX_TOOL_ROWS = 200;

const SYSTEM_PROMPT = `You are a senior data analyst. Answer the user's question end to end using ONLY the provided database.
- Use the execute_sql tool to run read-only SQL queries and inspect the REAL results. Query as many times as you need.
- Then produce ONE self-contained HTML dashboard fragment that visualizes the answer in a visualization. Embed the actual queried data directly in your inline script.
- Keep it focused: do NOT create multiple visualizations unless the question genuinely requires them. Prefer a single, well-chosen chart that answers the question; only add more charts when distinct facets of the question truly cannot be shown together.
- Make sure you write the RIGHT SQL that actually answers the question, and choose the RIGHT visualization for that answer.
- When you are finished, reply with ONLY the HTML fragment — no prose, no markdown fences, and no further tool calls.

${DASHBOARD_DESIGN_BRIEF}`;

const TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "execute_sql",
      description: "Run a single read-only SQL SELECT against the database. Returns rows as JSON.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "One read-only SQL SELECT statement." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
];

export interface BaselineToolCall {
  query: string;
  ok: boolean;
  rowCount?: number;
  error?: string;
}

export interface BaselineResult {
  ok: boolean;
  code: string;
  html: string;
  renderOk: boolean;
  iterations: number;
  toolCalls: BaselineToolCall[];
  modelSlug: string;
  reason?: string;
}

export interface BaselineOptions {
  context?: ContextProvider;
  db?: Pool;
}

export async function runBaselineLane(
  question: string,
  opts: BaselineOptions = {},
): Promise<BaselineResult> {
  const db = opts.db ?? getPool();
  const context = opts.context ?? (await buildContext(db));
  const planner = context.forPlanner();

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `${schemaBlock(planner)}\n\nQuestion: ${question}` },
  ];

  const toolCalls: BaselineToolCall[] = [];
  // Keep the actual rows (not just counts) so the host has embedded data for its
  // guaranteed-render fallback if the model's own component fails to render.
  const collected: { query: string; rows: unknown[] }[] = [];
  let code = "";
  let renderOk = false;
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    const res = await callModel({
      role: "baseline",
      lane: "baseline",
      messages,
      tools: TOOLS,
      temperature: 0,
      maxTokens: 4000,
    });

    // The model wants to run SQL: execute each tool call and feed results back.
    if (res.toolCalls && res.toolCalls.length > 0) {
      messages.push({ role: "assistant", content: res.text || null, tool_calls: res.toolCalls });
      for (const tc of res.toolCalls) {
        const query = parseQuery(tc.function.arguments);
        let content: string;
        try {
          const r = await runReadOnlyQuery(query, db);
          toolCalls.push({ query, ok: true, rowCount: r.rowCount });
          collected.push({ query, rows: r.rows.slice(0, MAX_TOOL_ROWS) });
          content = JSON.stringify({ rowCount: r.rowCount, rows: r.rows.slice(0, MAX_TOOL_ROWS) });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          toolCalls.push({ query, ok: false, error: msg });
          content = JSON.stringify({ error: msg });
        }
        messages.push({ role: "tool", tool_call_id: tc.id, content });
      }
      continue;
    }

    // Otherwise this turn is the final dashboard. Verify it renders; if not, let
    // the SAME strong model fix it once more within its own loop.
    code = stripCodeFence(res.text);
    const v = renderVerifier(code);
    if (v.ok) {
      renderOk = true;
      break;
    }
    messages.push({ role: "assistant", content: res.text });
    messages.push({
      role: "user",
      content: `That dashboard failed to build/render: ${v.reason}\nReturn ONLY the corrected self-contained HTML fragment.`,
    });
  }

  // Embedded data for the host fallback: one card per non-empty query result.
  const fallbackView = {
    title: question,
    charts: collected
      .filter((c) => Array.isArray(c.rows) && c.rows.length > 0)
      .map((c, i) => ({ id: `b${i}`, question: c.query, plan: { type: "bar" }, rows: c.rows })),
  };
  const html = buildDashboardHtml(code, fallbackView, `Baseline — ${question}`);
  return {
    ok: renderOk && code.length > 0,
    code,
    html,
    renderOk,
    iterations,
    toolCalls,
    modelSlug: MODELS.baseline.slug,
    ...(renderOk ? {} : { reason: "baseline did not produce a renderable component within the cap" }),
  };
}

function parseQuery(args: string): string {
  try {
    const parsed = JSON.parse(args || "{}");
    return typeof parsed.query === "string" ? parsed.query : "";
  } catch {
    return "";
  }
}

function schemaBlock(planner: PlannerContext): string {
  const tables =
    planner.schema.tables
      .map((t) => `${t.schema}.${t.name}(${t.columns.map((c) => `${c.name} ${c.type}`).join(", ")})`)
      .join("\n") || "(none)";
  const glossary =
    planner.glossary
      .map((g) => `- ${g.term}: ${g.definition}${g.sqlExpression ? ` [${g.sqlExpression}]` : ""}`)
      .join("\n") || "(none)";
  return `Schema:\n${tables}\n\nGlossary:\n${glossary}`;
}
