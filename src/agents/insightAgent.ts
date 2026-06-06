// agents/insightAgent: extracts a few factual insights from result data. Follows
// the runner template (own system prompt -> scoped context -> cheap model ->
// verify -> retry once -> escalate once -> stop). No schema or full glossary —
// only the column dictionary + the single metric in play (forInsight).
import { runAgent, type AgentResult, type AttemptFeedback } from "./runner.js";
import { insightVerifier } from "../verifiers/index.js";
import type {
  ContextProvider,
  ResultRow,
  InsightContext,
} from "../context/index.js";

const SYSTEM_PROMPT =
  "Extract 2-3 factual insights from the given data; cite only numbers present in it.";

export interface InsightAgentDeps {
  context: ContextProvider;
}

export interface InsightAgentSuccess {
  text: string;
}

export type InsightAgentResult = AgentResult<string, InsightAgentSuccess>;

export async function runInsightAgent(
  resultRows: ResultRow[],
  deps: InsightAgentDeps,
): Promise<InsightAgentResult> {
  const scoped = deps.context.forInsight(resultRows);

  return runAgent<string, InsightAgentSuccess>({
    name: "insight",
    systemPrompt: SYSTEM_PROMPT,
    cheapRole: "insight",
    // No dedicated insight-escalation model in the catalog; the strong model is
    // the escalation tier (still lane:"brain").
    escalationRole: "baseline",
    lane: "brain",
    temperature: 0,
    buildUserMessage: (feedback) => buildUserMessage(scoped, resultRows, feedback),
    parse: (raw) => raw.trim(),
    verify: (text) => {
      const v = insightVerifier(text, resultRows);
      return v.ok ? { ok: true, data: { text } } : { ok: false, ...(v.reason ? { reason: v.reason } : {}) };
    },
  });
}

// USER message: the data to analyze + its column dictionary + the one relevant
// metric definition. No DDL, no full glossary.
function buildUserMessage(
  scoped: InsightContext,
  resultRows: ResultRow[],
  feedback: AttemptFeedback | null,
): string {
  const parts: string[] = [
    "Columns:",
    scoped.columns.map((c) => `- ${c.name} (${c.type})`).join("\n") || "(none)",
  ];

  if (scoped.metric) {
    parts.push(
      "",
      `Metric in play: ${scoped.metric.term} — ${scoped.metric.definition}`,
    );
  }

  parts.push("", "Data:", JSON.stringify(resultRows));

  if (feedback) {
    parts.push(
      "",
      "Your previous insights failed verification. Fix them.",
      `Previous answer:\n${feedback.previousOutput.trim()}`,
      `Failure reason: ${feedback.reason}`,
    );
  }

  parts.push(
    "",
    "Return 2-3 short factual insights. Cite only numbers that appear in the data above.",
  );
  return parts.join("\n");
}
