// models: the single shared model client (OpenAI SDK pointed at OpenRouter).
// EVERY model call in the project routes through `callModel` so token usage and
// USD cost are accounted for automatically. No direct fetch/SDK call to
// OpenRouter should exist anywhere else.
import "dotenv/config";
import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { MODELS, type ModelRole } from "../../config/models.js";

// "brain" = the cheap-first decompose/verify/escalate swarm.
// "baseline" = the single strong model doing the whole task. We tag every call so
// the ledger can be grouped per lane for the side-by-side comparison.
export type Lane = "brain" | "baseline";

export interface CallModelArgs {
  /** Accounting label AND the pricing key (cost is read from MODELS[role]). */
  role: ModelRole;
  /** Slug to actually call. Defaults to MODELS[role].slug — pass to override. */
  model?: string;
  messages: ChatCompletionMessageParam[];
  temperature?: number;
  maxTokens?: number;
  tools?: ChatCompletionTool[];
  /** Defaults to "brain". Set "baseline" for the single-strong-model lane. */
  lane?: Lane;
}

export interface CallUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface CallResult {
  text: string;
  usage: CallUsage;
  /** Present when the model requested tool calls (tools were provided). */
  toolCalls?: NonNullable<
    OpenAI.Chat.Completions.ChatCompletionMessage["tool_calls"]
  >;
}

export interface LedgerEntry {
  role: ModelRole;
  model: string;
  lane: Lane;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

export interface LaneTotals {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

export interface Totals extends LaneTotals {
  byLane: Record<Lane, LaneTotals>;
}

// --- OpenRouter client (lazy, so importing this module never throws on a
// missing key — only an actual call does). ---
let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (client) return client;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Copy .env.example to .env and fill it in.",
    );
  }
  client = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
  });
  return client;
}

// --- Per-run ledger. In-memory; one process = one run. ---
const ledger: LedgerEntry[] = [];

/** Cost in USD for a role given token counts, using config pricing. */
export function computeCostUsd(
  role: ModelRole,
  promptTokens: number,
  completionTokens: number,
): number {
  const { inputPerMillion, outputPerMillion } = MODELS[role];
  return (
    (promptTokens / 1_000_000) * inputPerMillion +
    (completionTokens / 1_000_000) * outputPerMillion
  );
}

/**
 * The one entry point for model calls. Sends a chat completion through
 * OpenRouter, reads the `usage` off the response, appends a ledger entry, and
 * returns the assistant text plus token usage.
 */
export async function callModel(args: CallModelArgs): Promise<CallResult> {
  const {
    role,
    model = MODELS[role].slug,
    messages,
    temperature,
    maxTokens,
    tools,
    lane = "brain",
  } = args;

  const response = await getClient().chat.completions.create({
    model,
    messages,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
    ...(tools !== undefined ? { tools } : {}),
  });

  const choice = response.choices[0];
  const text = choice?.message?.content ?? "";
  const toolCalls = choice?.message?.tool_calls;

  // OpenRouter mirrors OpenAI's usage shape. Default to 0 if a provider omits it.
  const promptTokens = response.usage?.prompt_tokens ?? 0;
  const completionTokens = response.usage?.completion_tokens ?? 0;
  const costUsd = computeCostUsd(role, promptTokens, completionTokens);

  ledger.push({
    role,
    model,
    lane,
    promptTokens,
    completionTokens,
    costUsd,
  });

  return {
    text,
    usage: { promptTokens, completionTokens },
    ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
  };
}

export interface EmbedResult {
  embedding: number[];
  usage: CallUsage;
}

/**
 * Embed text through the same OpenRouter client and account it in the ledger.
 * Embeddings have prompt tokens only (no completion), so cost = inputPerMillion.
 * Defaults to the `embedding` role and lane:"brain".
 */
export async function embed(
  text: string,
  opts: { role?: ModelRole; lane?: Lane } = {},
): Promise<EmbedResult> {
  const role = opts.role ?? "embedding";
  const lane = opts.lane ?? "brain";
  const model = MODELS[role].slug;

  const response = await getClient().embeddings.create({ model, input: text });

  const promptTokens = response.usage?.prompt_tokens ?? 0;
  const completionTokens = 0;
  const costUsd = computeCostUsd(role, promptTokens, completionTokens);

  ledger.push({ role, model, lane, promptTokens, completionTokens, costUsd });

  return {
    embedding: response.data[0]?.embedding ?? [],
    usage: { promptTokens, completionTokens },
  };
}

/** All ledger entries for this run, in call order. Returns a copy. */
export function getLedger(): LedgerEntry[] {
  return ledger.slice();
}

function emptyLaneTotals(): LaneTotals {
  return { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 };
}

/**
 * Aggregate totals across the whole run, plus a per-lane breakdown so the
 * comparison UI can read "brain" vs "baseline" numbers straight from here.
 */
export function getTotals(): Totals {
  const totals: Totals = {
    ...emptyLaneTotals(),
    byLane: { brain: emptyLaneTotals(), baseline: emptyLaneTotals() },
  };

  for (const e of ledger) {
    const lane = totals.byLane[e.lane];
    for (const bucket of [totals, lane]) {
      bucket.calls += 1;
      bucket.promptTokens += e.promptTokens;
      bucket.completionTokens += e.completionTokens;
      bucket.costUsd += e.costUsd;
    }
  }

  return totals;
}

/** Clear the ledger. Useful between runs in a long-lived process or in tests. */
export function resetLedger(): void {
  ledger.length = 0;
}
