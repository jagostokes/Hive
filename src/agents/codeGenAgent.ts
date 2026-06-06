// agents/codeGenAgent: writes one self-contained React component for a chart spec
// + data. Follows the runner template. Scoped context = forCodeGen (the plan +
// the data only). No schema, no glossary.
import { runAgent, type AgentResult, type AttemptFeedback } from "./runner.js";
import { renderVerifier } from "../verifiers/index.js";
import { stripCodeFence } from "./parse.js";
import { escalationFor } from "../../config/models.js";
import { DASHBOARD_DESIGN_BRIEF, DASHBOARD_DATA_CONTRACT } from "../web/designBrief.js";
import type { ContextProvider, ResultRow, CodeGenContext } from "../context/index.js";

const SYSTEM_PROMPT = [
  "Given a dashboard spec and its data, output ONE self-contained React component. Code only.",
  "",
  DASHBOARD_DESIGN_BRIEF,
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
    maxTokens: 3500,
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
    "DASHBOARD (this is exactly the `data` prop):",
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
      "Your previous component failed to build/render. Fix it.",
      `Previous code:\n${feedback.previousOutput.trim()}`,
      `Build error: ${feedback.reason}`,
    );
  }

  parts.push(
    "",
    "Return ONE self-contained React component as code only. No prose, no fences.",
  );
  return parts.join("\n");
}
