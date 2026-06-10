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
  sqlGen: { slug: "deepseek/deepseek-v4-flash", inputPerMillion: 0.10, outputPerMillion: 0.20 },
  sqlEscalation: { slug: "deepseek/deepseek-v4-pro", inputPerMillion: 0.43, outputPerMillion: 0.87 },
  insight: { slug: "deepseek/deepseek-v4-flash", inputPerMillion: 0.1, outputPerMillion: 0.2 },
  dashboardPlan: { slug: "deepseek/deepseek-v4-flash", inputPerMillion: 0.10, outputPerMillion: 0.20 },
  // Dashboard code quality matters a lot for the demo, so codeGen runs on the
  // strongest non-flagship coder. Still ~29x cheaper on output than the baseline
  // flagship, so the brain lane keeps its large cost advantage.
  codeGen: { slug: "deepseek/deepseek-v4-pro", inputPerMillion: 0.43, outputPerMillion: 0.87 },
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

// Where each cheap role escalates on verified failure. Deliberately a mid-tier,
// still-cheap model — NOT the `baseline` flagship — so a brain-lane escalation
// stays inexpensive and never conflates the brain lane with the baseline lane it
// is measured against. Anything unmapped falls back to `baseline` as a last
// resort. Single source of truth for escalation, same as model choices.
export const ESCALATION: Partial<Record<ModelRole, ModelRole>> = {
  sqlGen: "sqlEscalation",
  insight: "planner",
  dashboardPlan: "planner",
  // codeGen already runs on the strong coder, so its only step up is the
  // flagship — a rare last resort if even that can't produce renderable HTML.
  codeGen: "baseline",
  codeEdit: "sqlEscalation",
};

/** The escalation role for a cheap role; `baseline` if none is configured. */
export function escalationFor(role: ModelRole): ModelRole {
  return ESCALATION[role] ?? "baseline";
}

/** Convenience accessor: the slug for a role. */
export function modelSlug(role: ModelRole): string {
  return MODELS[role].slug;
}
