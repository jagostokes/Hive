// agents/runner: the reusable TEMPLATE every sub-agent follows.
//
// Shape: a dedicated SYSTEM prompt (this agent's single role) + a USER message
// carrying ONLY this agent's scoped context, sent to a cheap model via the shared
// client (lane:"brain"); the output is parsed and gated by an OBJECTIVE verifier;
// on a verified failure the reason is fed back and we retry on the SAME cheap
// model, then escalate ONCE to a stronger model, then STOP. No uncapped loops.
//
// Everything agent-specific (the prompt, how the user message is built, how the
// output is parsed, and what "verified" means) is injected via AgentSpec, so
// other agents reuse this control flow verbatim.
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { callModel, type Lane } from "../models/index.js";
import { LOOP_CAPS, MODELS, type ModelRole } from "../../config/models.js";

/** Outcome of the objective verifier, optionally carrying a produced payload. */
export interface VerifyOutcome<TData> {
  ok: boolean;
  reason?: string;
  /** Verifier-produced data to return on success (e.g. the SQL result rows). */
  data?: TData;
}

/** Everything one agent must supply; the runner provides the control flow. */
export interface AgentSpec<TOutput, TData> {
  /** Short name for the trail/logs, e.g. "sql". */
  name: string;
  /** This agent's dedicated system prompt — its single role. Not shared. */
  systemPrompt: string;
  /** Cheap model role tried first (and once more on failure). */
  cheapRole: ModelRole;
  /**
   * Stronger model escalated to after cheap attempts are exhausted. Omit for
   * agents that retry on the cheap model then fail gracefully without escalating
   * (e.g. the planner).
   */
  escalationRole?: ModelRole;
  /**
   * Build the USER message. `feedback` is null on the first try and the previous
   * failure (reason + raw output) on a retry, so the agent can self-correct.
   * MUST include only this agent's scoped context — never the full context block.
   */
  buildUserMessage(feedback: AttemptFeedback | null): string;
  /** Turn raw model text into the agent's output type (e.g. extract SQL). */
  parse(raw: string): TOutput;
  /** Objective, deterministic gate. No model calls. */
  verify(output: TOutput): Promise<VerifyOutcome<TData>> | VerifyOutcome<TData>;
  lane?: Lane;
  temperature?: number;
  maxTokens?: number;
  /**
   * How to deliver the prompt. Default "system+user" keeps this agent's role in a
   * dedicated system message (the standing convention). "single-user" merges the
   * system prompt into one user message for models that reject multi-turn input.
   * "user-only" sends just the user message (systemPrompt is NOT sent) for models
   * with a rigid single-message input contract (e.g. the Relace fast-apply model,
   * which wants only its <code>/<update> tags) — such agents fold their role into
   * the user message themselves.
   */
  promptStyle?: "system+user" | "single-user" | "user-only";
}

export interface AttemptFeedback {
  previousOutput: string;
  reason: string;
}

export interface Attempt {
  /** 1-based index across the whole run (cheap + escalation). */
  index: number;
  phase: "cheap" | "escalation";
  role: ModelRole;
  model: string;
  rawOutput: string;
  ok: boolean;
  reason?: string;
}

export interface AgentSuccess<TOutput, TData> {
  ok: true;
  output: TOutput;
  data: TData;
  modelsUsed: string[];
  attempts: Attempt[];
}

export interface AgentFailure {
  ok: false;
  reason: string;
  modelsUsed: string[];
  attempts: Attempt[];
}

export type AgentResult<TOutput, TData> =
  | AgentSuccess<TOutput, TData>
  | AgentFailure;

/**
 * Runs an agent spec through the capped cheap → retry → escalate → stop loop and
 * returns the result plus the full attempt trail for observability.
 */
export async function runAgent<TOutput, TData>(
  spec: AgentSpec<TOutput, TData>,
): Promise<AgentResult<TOutput, TData>> {
  const lane = spec.lane ?? "brain";
  const attempts: Attempt[] = [];
  const modelsUsed: string[] = [];

  // Each phase = (role, how many tries). Caps come from config, never inline.
  // The escalation phase is only added when the agent configures an escalation
  // role; otherwise it retries on the cheap model then stops.
  const phases: Array<{ phase: "cheap" | "escalation"; role: ModelRole; tries: number }> = [
    { phase: "cheap", role: spec.cheapRole, tries: LOOP_CAPS.maxCheapAttempts },
  ];
  if (spec.escalationRole) {
    phases.push({
      phase: "escalation",
      role: spec.escalationRole,
      tries: LOOP_CAPS.maxEscalationAttempts,
    });
  }

  let feedback: AttemptFeedback | null = null;

  for (const { phase, role, tries } of phases) {
    for (let t = 0; t < tries; t++) {
      const userMessage = spec.buildUserMessage(feedback);
      const messages = buildMessages(spec, userMessage);

      const { text } = await callModel({
        role,
        lane,
        messages,
        ...(spec.temperature !== undefined ? { temperature: spec.temperature } : {}),
        ...(spec.maxTokens !== undefined ? { maxTokens: spec.maxTokens } : {}),
      });

      // Parsing or verification throwing (e.g. malformed JSON) is a RECOVERABLE
      // verified failure: record it, feed the reason back, and try again rather
      // than crashing the run.
      let output: TOutput | undefined;
      let outcome: VerifyOutcome<TData>;
      try {
        output = spec.parse(text);
        outcome = await spec.verify(output);
      } catch (err) {
        outcome = { ok: false, reason: err instanceof Error ? err.message : String(err) };
      }

      const model = MODELS[role].slug;
      modelsUsed.push(model);
      attempts.push({
        index: attempts.length + 1,
        phase,
        role,
        model,
        rawOutput: text,
        ok: outcome.ok,
        ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
      });

      if (outcome.ok) {
        return {
          ok: true,
          output: output as TOutput,
          data: outcome.data as TData,
          modelsUsed,
          attempts,
        };
      }

      // Verified failure: feed the reason (and what was produced) into the next try.
      feedback = {
        previousOutput: text,
        reason: outcome.reason ?? "verification failed",
      };
    }
  }

  // Exhausted cheap + escalation attempts. Stop gracefully — never loop further.
  return {
    ok: false,
    reason: feedback?.reason ?? "all attempts failed verification",
    modelsUsed,
    attempts,
  };
}

function buildMessages<TOutput, TData>(
  spec: AgentSpec<TOutput, TData>,
  userMessage: string,
): ChatCompletionMessageParam[] {
  switch (spec.promptStyle) {
    case "user-only":
      return [{ role: "user", content: userMessage }];
    case "single-user":
      return [{ role: "user", content: `${spec.systemPrompt}\n\n${userMessage}` }];
    default:
      return [
        { role: "system", content: spec.systemPrompt },
        { role: "user", content: userMessage },
      ];
  }
}
