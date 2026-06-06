// agents/dashboardPlanAgent: turns result data into a JSON chart spec. Follows
// the runner template. Scoped context = forDashboardPlan (result columns + a few
// sample rows). No schema, no glossary.
import { runAgent, type AgentResult, type AttemptFeedback } from "./runner.js";
import { planVerifier } from "../verifiers/index.js";
import { extractJsonObject } from "./parse.js";
import { escalationFor } from "../../config/models.js";
import type {
  ContextProvider,
  ResultRow,
  DashboardPlanContext,
} from "../context/index.js";

const SYSTEM_PROMPT =
  "Given result data, output a JSON chart spec (type, x, y, title) using only " +
  "columns present in the data. Choose the type that fits the data: " +
  '"line" for a trend over a date/time/month/day column; ' +
  '"doughnut" for a part-of-whole / share breakdown across a few categories; ' +
  '"kpi" for a single scalar result (one row or one number) — omit x; ' +
  '"bar" for comparing a numeric value across categories (the default). ' +
  "For trends, set x to the date/time column and y to the numeric measure.";

export interface DashboardPlanAgentDeps {
  context: ContextProvider;
}

export interface DashboardPlanAgentSuccess {
  plan: unknown;
}

export type DashboardPlanAgentResult = AgentResult<string, DashboardPlanAgentSuccess>;

export async function runDashboardPlanAgent(
  resultRows: ResultRow[],
  deps: DashboardPlanAgentDeps,
): Promise<DashboardPlanAgentResult> {
  const scoped = deps.context.forDashboardPlan(resultRows);
  const columns = scoped.columns.map((c) => c.name);

  return runAgent<string, DashboardPlanAgentSuccess>({
    name: "dashboardPlan",
    systemPrompt: SYSTEM_PROMPT,
    cheapRole: "dashboardPlan",
    escalationRole: escalationFor("dashboardPlan"),
    lane: "brain",
    temperature: 0,
    buildUserMessage: (feedback) => buildUserMessage(scoped, feedback),
    // Keep the raw text; JSON parsing + validation happen in verify so bad JSON
    // is a verified failure the agent can correct, not a thrown exception.
    parse: (raw) => raw,
    verify: (raw) => {
      let plan: unknown;
      try {
        plan = extractJsonObject(raw);
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) };
      }
      const v = planVerifier(plan, columns);
      return v.ok ? { ok: true, data: { plan } } : { ok: false, ...(v.reason ? { reason: v.reason } : {}) };
    },
  });
}

function buildUserMessage(
  scoped: DashboardPlanContext,
  feedback: AttemptFeedback | null,
): string {
  const parts: string[] = [
    "Result columns (use ONLY these for x/y/fields):",
    scoped.columns.map((c) => `- ${c.name} (${c.type})`).join("\n") || "(none)",
    "",
    "Sample rows:",
    JSON.stringify(scoped.sampleRows),
  ];

  if (feedback) {
    parts.push(
      "",
      "Your previous chart spec failed verification. Fix it.",
      `Previous answer:\n${feedback.previousOutput.trim()}`,
      `Failure reason: ${feedback.reason}`,
    );
  }

  parts.push(
    "",
    'Return ONLY a JSON object: {"type":"bar|line|doughnut|kpi","x":"<category/date column, omit for kpi>","y":"<numeric column>","title":"..."}.',
    "Pick line for a date/time trend, doughnut for share-of-total, kpi for a single value, bar otherwise.",
  );
  return parts.join("\n");
}
