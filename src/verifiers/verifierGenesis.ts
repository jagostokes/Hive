// verifiers/verifierGenesis: the "immune system" — synthesizes new verifier
// checks when existing verifiers miss a failure. A meta-agent writes a JavaScript
// predicate function, validates it against the known failure case, and persists
// it to `synthesized_verifiers` in Postgres. On future runs, the orchestrator
// loads all active synthesized verifiers and runs them alongside the built-in ones.
//
// This is the recursive testing mechanism: the system that tests itself, and
// grows new tests when it finds gaps.
import type { Pool } from "pg";
import { callModel } from "../models/index.js";

// ---------------------------------------------------------------------------
// Schema: each synthesized verifier is a JS predicate stored as text.
// ---------------------------------------------------------------------------

export interface SynthesizedVerifier {
  id: number;
  /** Which stage this verifier targets (e.g. "sql", "insight", "plan", "render"). */
  stage: string;
  /** Human-readable name describing what it checks. */
  name: string;
  /** The failure class it was synthesized to catch. */
  failureClass: string;
  /** The JS function body: receives (output, context) and returns {ok, reason?}. */
  predicateCode: string;
  /** Has it been validated against the original failure case? */
  validated: boolean;
  /** Is it active (run on every future check)? */
  active: boolean;
  /** How many times it has fired (caught a failure) since creation. */
  fireCount: number;
  /** How many times it ran without firing. */
  passCount: number;
  createdAt: Date;
}

export interface GenesisInput {
  /** Which stage failed (e.g. "sql", "insight", "plan", "render"). */
  stage: string;
  /** Description of the failure class (what went wrong and why). */
  failureDescription: string;
  /** The output that should have been caught. */
  failingOutput: string;
  /** Context about the input (question, schema, etc.) for the verifier to use. */
  inputContext: string;
  /** What the existing verifier said (passed, but it shouldn't have). */
  existingVerifierResult: string;
}

export interface GenesisResult {
  name: string;
  failureClass: string;
  predicateCode: string;
}

// ---------------------------------------------------------------------------
// The genesis meta-agent: given a failure the existing verifiers missed, it
// writes a new predicate function to catch that class of failure.
// ---------------------------------------------------------------------------

const GENESIS_SYSTEM =
  "You are a verifier engineer. Given a failure that the existing verifiers missed, " +
  "write a JavaScript function that would catch this class of failure in the future. " +
  "The function receives two arguments:\n" +
  "  1. `output` (string): the raw output from the agent\n" +
  "  2. `context` (object): {stage, question, schema?} — metadata about the run\n" +
  "It must return {ok: boolean, reason?: string}.\n" +
  "Rules:\n" +
  "- The function must be PURE — no side effects, no network calls, no imports.\n" +
  "- It must be GENERAL — catch the class of failure, not just this specific instance.\n" +
  "- It must be CONSERVATIVE — only reject outputs you're confident are wrong.\n" +
  "- Return ok:true when the output is fine; ok:false with a reason when it's bad.\n" +
  "Return ONLY this JSON:\n" +
  '{"name": "short descriptive name", "failureClass": "one-sentence description of what it catches", ' +
  '"predicateCode": "function(output, context) { ... return {ok: true}; }"}';

/**
 * Synthesize a new verifier predicate for a failure the existing verifiers missed.
 */
export async function synthesizeVerifier(input: GenesisInput): Promise<GenesisResult> {
  const userMessage = [
    `Stage: ${input.stage}`,
    "",
    `Failure description: ${input.failureDescription}`,
    "",
    "Failing output (should have been caught):",
    input.failingOutput.slice(0, 2000),
    "",
    "Input context:",
    input.inputContext.slice(0, 1000),
    "",
    `What the existing verifier said: ${input.existingVerifierResult}`,
    "",
    "Write a JavaScript predicate function that would catch this class of failure.",
    "Return ONLY the JSON.",
  ].join("\n");

  const res = await callModel({
    role: "planner",
    lane: "brain",
    temperature: 0,
    messages: [
      { role: "system", content: GENESIS_SYSTEM },
      { role: "user", content: userMessage },
    ],
  });

  const text = res.text.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Genesis returned non-JSON: ${text.slice(0, 200)}`);
  }
  const parsed = JSON.parse(jsonMatch[0]) as {
    name?: string;
    failureClass?: string;
    predicateCode?: string;
  };
  if (!parsed.name || !parsed.failureClass || !parsed.predicateCode) {
    throw new Error("Genesis JSON missing name, failureClass, or predicateCode");
  }
  return {
    name: parsed.name,
    failureClass: parsed.failureClass,
    predicateCode: parsed.predicateCode,
  };
}

// ---------------------------------------------------------------------------
// Validation: dry-run the synthesized predicate against the known failure case.
// If it correctly rejects the failing output, it's validated.
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  /** If invalid: why. */
  reason?: string;
  /** The predicate's output when run against the failing case. */
  predicateOutput?: { ok: boolean; reason?: string };
}

/**
 * Validate a synthesized predicate by running it against the known failure case.
 * The predicate must return {ok: false} for the failing output to be validated.
 * Uses Function constructor in a restricted scope (no imports, no side effects).
 */
export function validatePredicate(
  predicateCode: string,
  failingOutput: string,
  context: { stage: string; question?: string },
): ValidationResult {
  try {
    // Strip "function" wrapper if present — normalize to a callable.
    let body = predicateCode.trim();
    // Handle "function(output, context) { ... }" or "function name(output, context) { ... }"
    const fnMatch = body.match(/^function\s*\w*\s*\(([^)]*)\)\s*\{([\s\S]*)\}$/);
    if (fnMatch) {
      body = fnMatch[2];
    }
    // Handle arrow: "(output, context) => { ... }" or "(output, context) => ..."
    const arrowMatch = body.match(/^\(([^)]*)\)\s*=>\s*\{?([\s\S]*?)\}?$/);
    if (arrowMatch && !fnMatch) {
      body = arrowMatch[2];
    }

    // Create the function with restricted scope.
    const fn = new Function("output", "context", body) as (
      output: string,
      context: { stage: string; question?: string },
    ) => { ok: boolean; reason?: string };

    const result = fn(failingOutput, context);

    if (!result || typeof result.ok !== "boolean") {
      return { valid: false, reason: "predicate did not return {ok: boolean}" };
    }

    if (result.ok) {
      return {
        valid: false,
        reason: "predicate returned ok:true for the known failure — it would not catch this bug",
        predicateOutput: result,
      };
    }

    return { valid: true, predicateOutput: result };
  } catch (err) {
    return {
      valid: false,
      reason: `predicate threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Persistence: CRUD for synthesized_verifiers table.
// ---------------------------------------------------------------------------

/**
 * Save a validated synthesized verifier to the database.
 */
export async function saveSynthesizedVerifier(
  pool: Pool,
  stage: string,
  name: string,
  failureClass: string,
  predicateCode: string,
  validated: boolean,
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO synthesized_verifiers (stage, name, failure_class, predicate_code, validated, active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [stage, name, failureClass, predicateCode, validated, validated],
  );
  return Number(rows[0].id);
}

/**
 * Load all active synthesized verifiers for a given stage.
 */
export async function loadActiveVerifiers(
  pool: Pool,
  stage: string,
): Promise<SynthesizedVerifier[]> {
  const { rows } = await pool.query<{
    id: string;
    stage: string;
    name: string;
    failure_class: string;
    predicate_code: string;
    validated: boolean;
    active: boolean;
    fire_count: string;
    pass_count: string;
    created_at: Date;
  }>(
    `SELECT id, stage, name, failure_class, predicate_code, validated, active, fire_count, pass_count, created_at
     FROM synthesized_verifiers
     WHERE stage = $1 AND active = true
     ORDER BY created_at ASC`,
    [stage],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    stage: r.stage,
    name: r.name,
    failureClass: r.failure_class,
    predicateCode: r.predicate_code,
    validated: r.validated,
    active: r.active,
    fireCount: Number(r.fire_count),
    passCount: Number(r.pass_count),
    createdAt: r.created_at,
  }));
}

/**
 * Load ALL synthesized verifiers (active and inactive) for diagnostics.
 */
export async function loadAllVerifiers(pool: Pool): Promise<SynthesizedVerifier[]> {
  const { rows } = await pool.query<{
    id: string;
    stage: string;
    name: string;
    failure_class: string;
    predicate_code: string;
    validated: boolean;
    active: boolean;
    fire_count: string;
    pass_count: string;
    created_at: Date;
  }>(
    `SELECT id, stage, name, failure_class, predicate_code, validated, active, fire_count, pass_count, created_at
     FROM synthesized_verifiers
     ORDER BY created_at ASC`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    stage: r.stage,
    name: r.name,
    failureClass: r.failure_class,
    predicateCode: r.predicate_code,
    validated: r.validated,
    active: r.active,
    fireCount: Number(r.fire_count),
    passCount: Number(r.pass_count),
    createdAt: r.created_at,
  }));
}

/**
 * Increment the fire_count (the verifier caught a failure) or pass_count.
 */
export async function recordVerifierOutcome(
  pool: Pool,
  verifierId: number,
  fired: boolean,
): Promise<void> {
  const col = fired ? "fire_count" : "pass_count";
  await pool.query(
    `UPDATE synthesized_verifiers SET ${col} = ${col} + 1 WHERE id = $1`,
    [verifierId],
  );
}

/**
 * Deactivate a synthesized verifier (e.g. too many false positives).
 */
export async function deactivateVerifier(
  pool: Pool,
  verifierId: number,
): Promise<void> {
  await pool.query(
    `UPDATE synthesized_verifiers SET active = false WHERE id = $1`,
    [verifierId],
  );
}

// ---------------------------------------------------------------------------
// Runtime: run all synthesized verifiers for a stage against an output.
// ---------------------------------------------------------------------------

export interface SynthesizedCheckResult {
  /** Overall: ok only if ALL synthesized verifiers pass. */
  ok: boolean;
  /** The first failing verifier's rejection, if any. */
  reason?: string;
  /** Which synthesized verifier fired (by id), if any. */
  firedVerifierId?: number;
  /** Total synthesized verifiers run. */
  checked: number;
}

/**
 * Run all active synthesized verifiers for a stage. Returns the first failure
 * (if any) so it can be fed back for retry/escalation. Also increments counters.
 */
export async function runSynthesizedVerifiers(
  pool: Pool,
  stage: string,
  output: string,
  context: { question?: string },
): Promise<SynthesizedCheckResult> {
  const verifiers = await loadActiveVerifiers(pool, stage);
  if (verifiers.length === 0) {
    return { ok: true, checked: 0 };
  }

  for (const v of verifiers) {
    const validation = validatePredicate(v.predicateCode, output, {
      stage,
      ...context,
    });

    if (validation.predicateOutput && !validation.predicateOutput.ok) {
      // The synthesized verifier caught something.
      await recordVerifierOutcome(pool, v.id, true);
      return {
        ok: false,
        reason: `[synth:${v.name}] ${validation.predicateOutput.reason ?? v.failureClass}`,
        firedVerifierId: v.id,
        checked: verifiers.length,
      };
    }

    // Passed — record it.
    await recordVerifierOutcome(pool, v.id, false);
  }

  return { ok: true, checked: verifiers.length };
}

// ---------------------------------------------------------------------------
// Full genesis flow: synthesize → validate → persist.
// ---------------------------------------------------------------------------

/**
 * Full recursive testing flow:
 *   1. Synthesize a new verifier for the uncaught failure
 *   2. Validate it against the known failing case
 *   3. If validated, persist it as active
 *   4. Return the result
 */
export async function performGenesis(
  pool: Pool,
  input: GenesisInput,
): Promise<GenesisResult & { verifierId?: number; validated: boolean }> {
  const result = await synthesizeVerifier(input);

  const validation = validatePredicate(result.predicateCode, input.failingOutput, {
    stage: input.stage,
    question: input.inputContext,
  });

  const validated = validation.valid;
  const verifierId = await saveSynthesizedVerifier(
    pool,
    input.stage,
    result.name,
    result.failureClass,
    result.predicateCode,
    validated,
  );

  return { ...result, verifierId, validated };
}
