// agents/plannerAgent: decomposes the user's question into a DAG of sub-questions
// with parallel groups identified. Built on the runner template, but with NO
// escalation — per spec it validates the JSON shape, retries once on failure,
// then fails gracefully. Scoped context = forPlanner() (full schema + glossary).
import { runAgent, type AgentResult, type AttemptFeedback } from "./runner.js";
import { extractJsonObject } from "./parse.js";
import type { ContextProvider, PlannerContext } from "../context/index.js";

const SYSTEM_PROMPT =
  "You are a query planner. Decompose the user's data question into the minimal " +
  "set of sub-questions needed to answer it, using only the provided schema and " +
  "glossary. Mark dependencies: a sub-question depends on another ONLY when it " +
  "literally needs that other sub-question's result as input. Independent metrics " +
  "(genuinely separate asks) must have no dependencies so they can run in parallel. " +
  "PRESERVE COMPARATIVE INTENT — this is critical and overrides the urge to split: " +
  "if the question COMPARES or RELATES values across periods, segments, categories, " +
  "or groups (cues: 'compare', 'A vs B', 'from X to Y', 'change/growth/difference', " +
  "'by region', 'per status', 'over time', 'trend', 'top N by …'), that comparison " +
  "is ONE sub-question whose single result set returns ALL compared groups TOGETHER " +
  "(e.g. grouped by month/period/category, or both periods in one query). Do NOT " +
  "split each side of a comparison into separate sub-questions — that destroys the " +
  "comparison, producing disconnected single-value cards instead of one side-by-side " +
  "chart. Example: 'compare sales in Jan 2017 vs Jan 2018' is ONE sub-question " +
  "('total sales grouped by month for January 2017 and January 2018'), NOT two. " +
  "CRITICAL: each sub-question is answered INDEPENDENTLY with no shared context, so " +
  "every sub-question MUST be fully self-contained — restate ALL shared qualifiers " +
  "from the original question in EACH one: time windows (e.g. 'in the last 30 days'), " +
  "status/segment filters (e.g. 'paid orders only'), groupings, and units. A " +
  "sub-question must read as a complete question on its own. Return ONLY JSON.";

export interface PlanNode {
  id: string;
  question: string;
  /** Ids of sub-questions that must finish before this one. */
  dependsOn: string[];
}

export interface Plan {
  subQuestions: PlanNode[];
  /**
   * Ordered execution levels. Each inner array is a set of sub-question ids with
   * no unmet dependencies — i.e. a parallel group. groups[0] runs first, etc.
   */
  groups: string[][];
}

export interface PlannerAgentDeps {
  context: ContextProvider;
}

export type PlannerAgentResult = AgentResult<Plan, Plan>;

export async function runPlanner(
  question: string,
  deps: PlannerAgentDeps,
): Promise<PlannerAgentResult> {
  const scoped = deps.context.forPlanner();

  return runAgent<Plan, Plan>({
    name: "planner",
    systemPrompt: SYSTEM_PROMPT,
    cheapRole: "planner",
    // No escalation: retry once on the planner model, then fail gracefully.
    lane: "brain",
    temperature: 0,
    // The planner model is a reasoning model: its hidden reasoning trace shares
    // the completion budget. 1200 was too small — a long trace exhausted it and
    // the response came back truncated with EMPTY content (finish_reason:length),
    // which deterministically failed both tries at temp 0. Give it ample room so
    // reasoning + the (small) JSON both fit.
    maxTokens: 4000,
    buildUserMessage: (feedback) => buildUserMessage(scoped, question, feedback),
    // Parse + validate + build the DAG. Any problem throws and is reported as a
    // verified failure so the model can correct on the retry.
    parse: (raw) => buildPlan(raw),
    verify: (plan) => ({ ok: true, data: plan }),
  });
}

function buildUserMessage(
  scoped: PlannerContext,
  question: string,
  feedback: AttemptFeedback | null,
): string {
  const parts: string[] = [
    "Schema:",
    formatSchema(scoped),
    "",
    "Glossary:",
    formatGlossary(scoped),
    "",
    `Question: ${question}`,
    "",
    "Return ONLY this JSON shape:",
    '{"subQuestions":[{"id":"q1","question":"...","dependsOn":[]},' +
      '{"id":"q2","question":"...","dependsOn":["q1"]}]}',
    "Use short ids (q1, q2, ...). dependsOn lists ids that must finish first; " +
      "use [] for independent sub-questions.",
    "Keep comparisons together: if the question compares/relates values across " +
      "periods, segments, or categories (e.g. '2017 vs 2018', 'by region', 'over " +
      "time'), make it ONE sub-question whose result returns all compared groups in " +
      "a single grouped result set — never one sub-question per side.",
    "Each sub-question must be self-contained: carry over every filter from the " +
      "original question (date range, status, segment) into each sub-question text, " +
      "because each is run on its own without the others' context.",
  ];

  if (feedback) {
    parts.push(
      "",
      "Your previous output was invalid. Fix it.",
      `Previous output:\n${feedback.previousOutput.trim()}`,
      `Reason: ${feedback.reason}`,
    );
  }
  return parts.join("\n");
}

function formatSchema(scoped: PlannerContext): string {
  if (scoped.schema.tables.length === 0) return "(none)";
  return scoped.schema.tables
    .map((t) => {
      const cols = t.columns.map((c) => `${c.name} ${c.type}`).join(", ");
      return `${t.schema}.${t.name}(${cols})`;
    })
    .join("\n");
}

function formatGlossary(scoped: PlannerContext): string {
  if (scoped.glossary.length === 0) return "(none)";
  return scoped.glossary
    .map((g) => `- ${g.term}: ${g.definition}${g.sqlExpression ? ` [${g.sqlExpression}]` : ""}`)
    .join("\n");
}

// --- Validation + DAG construction ---------------------------------------

/** Parse model JSON into a validated Plan with parallel groups. Throws on any
 *  shape/dependency problem (caught by the runner as a verified failure). */
export function buildPlan(raw: string): Plan {
  const parsed = extractJsonObject(raw) as Record<string, unknown>;
  const list = parsed.subQuestions ?? parsed.sub_questions ?? parsed.questions;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('expected a non-empty "subQuestions" array');
  }

  const nodes: PlanNode[] = list.map((item, i) => normalizeNode(item, i));

  const ids = new Set(nodes.map((n) => n.id));
  if (ids.size !== nodes.length) {
    throw new Error("sub-question ids must be unique");
  }
  for (const n of nodes) {
    for (const dep of n.dependsOn) {
      if (!ids.has(dep)) {
        throw new Error(`sub-question ${n.id} depends on unknown id ${dep}`);
      }
      if (dep === n.id) {
        throw new Error(`sub-question ${n.id} depends on itself`);
      }
    }
  }

  const groups = computeParallelGroups(nodes);
  return { subQuestions: nodes, groups };
}

function normalizeNode(item: unknown, index: number): PlanNode {
  if (!item || typeof item !== "object") {
    throw new Error(`sub-question ${index} is not an object`);
  }
  const obj = item as Record<string, unknown>;
  const id = obj.id !== undefined ? String(obj.id) : `q${index + 1}`;
  const question = obj.question ?? obj.text ?? obj.subQuestion;
  if (typeof question !== "string" || question.trim() === "") {
    throw new Error(`sub-question ${id} is missing a "question" string`);
  }
  const rawDeps = obj.dependsOn ?? obj.depends_on ?? obj.dependencies ?? [];
  if (!Array.isArray(rawDeps)) {
    throw new Error(`sub-question ${id} has a non-array "dependsOn"`);
  }
  return { id, question: question.trim(), dependsOn: rawDeps.map((d) => String(d)) };
}

/**
 * Topological leveling (Kahn-style): each level contains every remaining node
 * whose dependencies are all already placed. Levels are the parallel groups; a
 * level that comes back empty with nodes remaining means a dependency cycle.
 */
export function computeParallelGroups(nodes: PlanNode[]): string[][] {
  const placed = new Set<string>();
  const remaining = new Map(nodes.map((n) => [n.id, n]));
  const groups: string[][] = [];

  while (remaining.size > 0) {
    const level: string[] = [];
    for (const node of remaining.values()) {
      if (node.dependsOn.every((d) => placed.has(d))) level.push(node.id);
    }
    if (level.length === 0) {
      throw new Error("dependency cycle detected in plan");
    }
    for (const id of level) {
      placed.add(id);
      remaining.delete(id);
    }
    groups.push(level);
  }
  return groups;
}
