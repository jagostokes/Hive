// agents/insightAgent: extracts a few factual insights from result data. Follows
// the runner template (own system prompt -> scoped context -> cheap model ->
// verify -> retry once -> escalate once -> stop). No schema or full glossary —
// only the column dictionary + the single metric in play (forInsight).
import { runAgent, type AgentResult, type AttemptFeedback } from "./runner.js";
import { insightVerifier } from "../verifiers/index.js";
import { escalationFor } from "../../config/models.js";
import type {
  ContextProvider,
  ResultRow,
  InsightContext,
} from "../context/index.js";

const SYSTEM_PROMPT =
  "Write ONE concise analytical takeaway about the data — the single most useful " +
  "headline finding (e.g. which category leads and by how much / what share, or the " +
  "direction of a trend). One short sentence, no bullet lists, no row-by-row " +
  "enumeration. Cite only numbers present in the data.";

// Cap the rows we hand to the insight model. A one-sentence headline finding
// does NOT need the full result set; passing 10k+ rows verbatim cost ~$0.05+
// per call on the cheap insight model and several times that on escalation.
// We send up to MAX_INSIGHT_ROWS rows + an explicit "and N more" note so the
// model knows it is looking at a representative sample.
const MAX_INSIGHT_ROWS = 50;

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
    escalationRole: escalationFor("insight"),
    lane: "brain",
    temperature: 0,
    // Bound the completion. The output is ONE short sentence; without a cap a
    // reasoning-family model (deepseek-v4-flash) can spend an unbounded hidden
    // trace and take 60s+ for a one-liner. 1024 leaves ample room for any short
    // reasoning plus the sentence. Insight is supplementary, so even a truncation
    // does not sink the lane.
    maxTokens: 1024,
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

  const total = resultRows.length;
  const sample = resultRows.slice(0, MAX_INSIGHT_ROWS);
  const truncated = total > sample.length;
  parts.push(
    "",
    truncated
      ? `Data (first ${sample.length} of ${total} rows; the full result set is larger but this is a representative sample):`
      : "Data:",
    JSON.stringify(sample),
  );

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
    "Return ONE short analytical sentence (the headline takeaway). No lists. Cite only numbers that appear in the data above.",
  );
  return parts.join("\n");
}
