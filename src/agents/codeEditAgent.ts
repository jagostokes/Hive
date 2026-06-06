// agents/codeEditAgent: fixes a broken React component given its render error.
// Uses the fast-apply edit model (role: codeEdit). Follows the runner template.
// Scoped context = forCodeEdit (the component + the error only) — no schema, no
// glossary, no data. Only invoked when codeGen's output fails to render.
import { runAgent, type AgentResult, type AttemptFeedback } from "./runner.js";
import { renderVerifier } from "../verifiers/index.js";
import { stripCodeFence } from "./parse.js";
import type { ContextProvider, CodeEditContext } from "../context/index.js";

const SYSTEM_PROMPT =
  "Given a broken component and its render error, return the fixed component. Code only.";

export interface CodeEditAgentDeps {
  context: ContextProvider;
}

export interface CodeEditAgentSuccess {
  code: string;
}

export type CodeEditAgentResult = AgentResult<string, CodeEditAgentSuccess>;

export async function runCodeEditAgent(
  component: string,
  error: string,
  deps: CodeEditAgentDeps,
): Promise<CodeEditAgentResult> {
  const scoped = deps.context.forCodeEdit(component, error);

  return runAgent<string, CodeEditAgentSuccess>({
    name: "codeEdit",
    systemPrompt: SYSTEM_PROMPT,
    cheapRole: "codeEdit",
    escalationRole: "baseline",
    lane: "brain",
    temperature: 0,
    maxTokens: 1500,
    buildUserMessage: (feedback) => buildUserMessage(scoped, feedback),
    parse: (raw) => stripCodeFence(raw),
    verify: (code) => {
      const v = renderVerifier(code);
      return v.ok ? { ok: true, data: { code } } : { ok: false, ...(v.reason ? { reason: v.reason } : {}) };
    },
  });
}

function buildUserMessage(
  scoped: CodeEditContext,
  feedback: AttemptFeedback | null,
): string {
  const parts: string[] = [
    "Broken component:",
    scoped.component,
    "",
    `Render error: ${scoped.error}`,
  ];

  if (feedback) {
    parts.push(
      "",
      "Your previous fix still failed to build/render. Try again.",
      `Previous code:\n${feedback.previousOutput.trim()}`,
      `Build error: ${feedback.reason}`,
    );
  }

  parts.push("", "Return the fixed component as code only. No prose, no fences.");
  return parts.join("\n");
}
