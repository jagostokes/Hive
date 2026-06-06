// agents/codeEditAgent: fixes a broken React component given its render error.
// Uses the fast-apply edit model (role: codeEdit). Follows the runner template.
// Scoped context = forCodeEdit (the component + the error only) — no schema, no
// glossary, no data. Only invoked when codeGen's output fails to render.
import { runAgent, type AgentResult, type AttemptFeedback } from "./runner.js";
import { renderVerifier } from "../verifiers/index.js";
import { stripCodeFence } from "./parse.js";
import { escalationFor } from "../../config/models.js";
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
    escalationRole: escalationFor("codeEdit"),
    lane: "brain",
    temperature: 0,
    maxTokens: 1500,
    // Relace fast-apply has a rigid contract: a single user message with only its
    // <code>/<update> tags, no system role. We fold the role into that message.
    promptStyle: "user-only",
    buildUserMessage: (feedback) => buildUserMessage(scoped, feedback),
    parse: (raw) => stripCodeFence(raw),
    verify: (code) => {
      const v = renderVerifier(code);
      return v.ok ? { ok: true, data: { code } } : { ok: false, ...(v.reason ? { reason: v.reason } : {}) };
    },
  });
}

// The Relace fast-apply model expects exactly one user message shaped as
// <code>{current file}</code><update>{the edit to apply}</update> and returns the
// merged file. We put the broken component in <code> and the fix instruction
// (driven by the render error) in <update>. The strong escalation model reads the
// same tagged message fine. SYSTEM_PROMPT's role is folded into <update>.
function buildUserMessage(
  scoped: CodeEditContext,
  feedback: AttemptFeedback | null,
): string {
  // On a retry, operate on the last (still-broken) output rather than the
  // original, and surface the latest build error.
  const code = feedback?.previousOutput.trim() || scoped.component;
  const renderError = feedback?.reason ?? scoped.error;

  const update =
    `${SYSTEM_PROMPT} The component fails to build/render with this error: ` +
    `${renderError}. Rewrite it so it compiles and renders, returning the ` +
    `complete corrected component (code only).`;

  return `<code>\n${code}\n</code>\n<update>\n${update}\n</update>`;
}
