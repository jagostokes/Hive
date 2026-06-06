// config: the SINGLE source of truth for model choices, prices, and loop caps.
// Swapping a model or repricing a role = editing THIS file only. Nothing else in
// the project should name a model slug inline.
//
// Slugs are OpenRouter catalog ids (verified against the catalog). Prices are USD
// per *one million* tokens, split into input (prompt) and output (completion),
// taken from the catalog. `outputPerMillion: 0` means the role has no billable
// completion tokens (e.g. embeddings).

export type ModelRole =
  | "embedding"
  | "planner"
  | "sqlGen"
  | "sqlEscalation"
  | "insight"
  | "dashboardPlan"
  | "codeGen"
  | "codeEdit"
  | "baseline";

export interface ModelSpec {
  /** OpenRouter slug passed straight to the OpenAI SDK as `model`. */
  slug: string;
  /** USD per 1,000,000 input (prompt) tokens. */
  inputPerMillion: number;
  /** USD per 1,000,000 output (completion) tokens. 0 if not applicable. */
  outputPerMillion: number;
}

// One entry per role. The model client computes cost from the pricing here, keyed
// by the call's `role`, so this map is the cost source of truth for the whole run.
export const MODELS: Record<ModelRole, ModelSpec> = {
  // Embeddings are not served over OpenRouter's chat catalog; this role is routed
  // separately by the cache/embedding path. Output tokens are not billed.
  embedding: { slug: "openai/text-embedding-3-small", inputPerMillion: 0.02, outputPerMillion: 0 },
  planner: { slug: "deepseek/deepseek-v4-pro", inputPerMillion: 0.43, outputPerMillion: 0.87 },
  sqlGen: { slug: "qwen/qwen3-coder-30b-a3b-instruct", inputPerMillion: 0.07, outputPerMillion: 0.27 },
  sqlEscalation: { slug: "qwen/qwen3-coder-plus", inputPerMillion: 0.65, outputPerMillion: 3.3 },
  insight: { slug: "deepseek/deepseek-v4-flash", inputPerMillion: 0.1, outputPerMillion: 0.2 },
  dashboardPlan: { slug: "google/gemini-2.5-flash-lite", inputPerMillion: 0.1, outputPerMillion: 0.4 },
  codeGen: { slug: "qwen/qwen3-coder-flash", inputPerMillion: 0.2, outputPerMillion: 0.97 },
  codeEdit: { slug: "relace/relace-apply-3", inputPerMillion: 0.85, outputPerMillion: 1.3 },
  baseline: { slug: "anthropic/claude-opus-4.8", inputPerMillion: 5.0, outputPerMillion: 25.0 },
};

// Capped loops apply to every agent: a few cheap attempts, then one escalation,
// then stop. Kept here so the policy lives with the model choices it governs.
export const LOOP_CAPS = {
  /** Attempts on the cheap model before escalating (inclusive of the first try). */
  maxCheapAttempts: 2,
  /** Attempts on the stronger escalation model after cheap attempts are exhausted. */
  maxEscalationAttempts: 1,
} as const;

/** Convenience accessor: the slug for a role. */
export function modelSlug(role: ModelRole): string {
  return MODELS[role].slug;
}
