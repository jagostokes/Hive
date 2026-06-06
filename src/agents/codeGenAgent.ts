// agents/codeGenAgent: writes one self-contained HTML dashboard fragment (markup
// + an inline <script> drawing charts with Chart.js) for a plan + data. Follows
// the runner template. Scoped context = forCodeGen (the plan + the data only).
// No schema, no glossary.
import { runAgent, type AgentResult, type AttemptFeedback } from "./runner.js";
import { renderVerifier } from "../verifiers/index.js";
import { stripCodeFence } from "./parse.js";
import { escalationFor } from "../../config/models.js";
import {
  DASHBOARD_DESIGN_BRIEF,
  DASHBOARD_DATA_CONTRACT,
  DASHBOARD_EXAMPLE,
} from "../web/designBrief.js";
import type { ContextProvider, ResultRow, CodeGenContext } from "../context/index.js";

const SYSTEM_PROMPT = [
  "Given a dashboard spec and its data, output ONE self-contained HTML dashboard fragment. HTML only.",
  "",
  DASHBOARD_DESIGN_BRIEF,
  "",
  "REFERENCE EXAMPLE — a known-good, correct dashboard fragment. Start from this exact structure and adapt it to the data (you may keep it almost verbatim; it already reads window.DASHBOARD_DATA). Do NOT regress on the canvas height wrapper or maintainAspectRatio:false.",
  DASHBOARD_EXAMPLE,
].join("\n");

export interface CodeGenAgentDeps {
  context: ContextProvider;
}

export interface CodeGenAgentSuccess {
  code: string;
}

export type CodeGenAgentResult = AgentResult<string, CodeGenAgentSuccess>;

export async function runCodeGenAgent(
  plan: unknown,
  data: ResultRow[],
  deps: CodeGenAgentDeps,
): Promise<CodeGenAgentResult> {
  const scoped = deps.context.forCodeGen(plan, data);

  return runAgent<string, CodeGenAgentSuccess>({
    name: "codeGen",
    systemPrompt: SYSTEM_PROMPT,
    cheapRole: "codeGen",
    escalationRole: escalationFor("codeGen"),
    lane: "brain",
    temperature: 0,
    maxTokens: 4000,
    buildUserMessage: (feedback) => buildUserMessage(scoped, feedback),
    parse: (raw) => stripCodeFence(raw),
    verify: (code) => {
      const v = renderVerifier(code);
      return v.ok ? { ok: true, data: { code } } : { ok: false, ...(v.reason ? { reason: v.reason } : {}) };
    },
  });
}

function buildUserMessage(
  scoped: CodeGenContext,
  feedback: AttemptFeedback | null,
): string {
  const parts: string[] = [
    DASHBOARD_DATA_CONTRACT,
    "",
    "DASHBOARD DATA (also exposed to your script as the global DASHBOARD_DATA):",
    JSON.stringify(scoped.plan),
  ];

  // The orchestrator carries everything in `plan` (the full view incl. rows).
  // Only show the legacy `data` slot when something is actually passed there.
  if (Array.isArray(scoped.data) && scoped.data.length > 0) {
    parts.push("", "Additional data rows:", JSON.stringify(scoped.data));
  }

  if (feedback) {
    parts.push(
      "",
      "Your previous dashboard failed verification. Fix it.",
      `Previous HTML:\n${feedback.previousOutput.trim()}`,
      `Error: ${feedback.reason}`,
    );
  }

  parts.push(
    "",
    "Return ONE self-contained HTML fragment as HTML only. No prose, no code fences, no <html>/<head>/<body>/<script src>.",
  );
  return parts.join("\n");
}
