// agents/promptSurgery: when a verifier rejects agent output, the surgeon
// diagnoses WHY the system prompt failed and rewrites it. The new version is
// persisted to `prompt_versions` so future runs load the improved prompt.
//
// The surgeon itself runs on the planner model (cheap, good at reasoning) and
// does NOT go through the runner template — it's a one-shot meta-agent, not a
// capped-loop agent.
import type { Pool } from "pg";
import { callModel } from "../models/index.js";
// ModelRole is used by callers but not directly here; kept as reference.
// import type { ModelRole } from "../../config/models.js";

export interface PromptVersion {
  id: number;
  role: string;
  generation: number;
  systemPrompt: string;
  parentId: number | null;
  diagnosis: string | null;
  winRate: number | null;
  createdAt: Date;
}

/** Load the latest prompt version for a role, or null if no versions exist. */
export async function loadLatestPrompt(
  pool: Pool,
  role: string,
): Promise<PromptVersion | null> {
  const { rows } = await pool.query<{
    id: string;
    role: string;
    generation: number;
    system_prompt: string;
    parent_id: string | null;
    diagnosis: string | null;
    win_rate: number | null;
    created_at: Date;
  }>(
    `SELECT id, role, generation, system_prompt, parent_id, diagnosis, win_rate, created_at
     FROM prompt_versions
     WHERE role = $1
     ORDER BY generation DESC
     LIMIT 1`,
    [role],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: Number(r.id),
    role: r.role,
    generation: r.generation,
    systemPrompt: r.system_prompt,
    parentId: r.parent_id ? Number(r.parent_id) : null,
    diagnosis: r.diagnosis,
    winRate: r.win_rate,
    createdAt: r.created_at,
  };
}

/** Load all prompt versions for a role, ordered by generation ascending. */
export async function loadPromptHistory(
  pool: Pool,
  role: string,
): Promise<PromptVersion[]> {
  const { rows } = await pool.query<{
    id: string;
    role: string;
    generation: number;
    system_prompt: string;
    parent_id: string | null;
    diagnosis: string | null;
    win_rate: number | null;
    created_at: Date;
  }>(
    `SELECT id, role, generation, system_prompt, parent_id, diagnosis, win_rate, created_at
     FROM prompt_versions
     WHERE role = $1
     ORDER BY generation ASC`,
    [role],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    role: r.role,
    generation: r.generation,
    systemPrompt: r.system_prompt,
    parentId: r.parent_id ? Number(r.parent_id) : null,
    diagnosis: r.diagnosis,
    winRate: r.win_rate,
    createdAt: r.created_at,
  }));
}

export interface SurgeryInput {
  /** The agent role whose prompt failed (e.g. "sqlGen"). */
  role: string;
  /** The system prompt that was used when the failure happened. */
  currentPrompt: string;
  /** The user message / sub-question that triggered the failure. */
  userMessage: string;
  /** The raw model output that was rejected. */
  rejectedOutput: string;
  /** The verifier's rejection reason. */
  verifierReason: string;
}

export interface SurgeryResult {
  diagnosis: string;
  newPrompt: string;
}

const SURGEON_SYSTEM =
  "You are a prompt surgeon. You are given a system prompt that an agent used, " +
  "the input it received, the output it produced, and why the verifier rejected " +
  "it. Diagnose the root cause in the system prompt (not in the input data) and " +
  "rewrite the system prompt to prevent this class of failure. Preserve the " +
  "agent's core role and all existing rules that are not related to the failure. " +
  "Be surgical: change as little as possible. Return ONLY this JSON shape:\n" +
  '{"diagnosis": "one-sentence root cause", "newPrompt": "the full rewritten system prompt"}';

/**
 * Run the surgeon: diagnose why a prompt failed and produce a rewritten version.
 * One-shot, no retry loop — the surgeon is a meta-agent, not a production agent.
 */
export async function runSurgeon(input: SurgeryInput): Promise<SurgeryResult> {
  const userMessage = [
    `Agent role: ${input.role}`,
    "",
    "Current system prompt:",
    input.currentPrompt,
    "",
    "User message (the input the agent received):",
    input.userMessage,
    "",
    "Rejected output:",
    input.rejectedOutput,
    "",
    `Verifier rejection reason: ${input.verifierReason}`,
    "",
    "Return ONLY the JSON with diagnosis and newPrompt.",
  ].join("\n");

  const res = await callModel({
    role: "planner", // cheap reasoning model
    lane: "brain",
    temperature: 0,
    messages: [
      { role: "system", content: SURGEON_SYSTEM },
      { role: "user", content: userMessage },
    ],
  });

  const text = res.text.trim();
  // Extract JSON from potential code fences.
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Surgeon returned non-JSON: ${text.slice(0, 200)}`);
  }
  const parsed = JSON.parse(jsonMatch[0]) as { diagnosis?: string; newPrompt?: string };
  if (!parsed.diagnosis || !parsed.newPrompt) {
    throw new Error("Surgeon JSON missing diagnosis or newPrompt");
  }
  return { diagnosis: parsed.diagnosis, newPrompt: parsed.newPrompt };
}

/**
 * Persist a new prompt version after surgery. Returns the new row's id.
 */
export async function savePromptVersion(
  pool: Pool,
  role: string,
  newPrompt: string,
  diagnosis: string,
  parentId: number | null,
  generation: number,
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO prompt_versions (role, generation, system_prompt, parent_id, diagnosis)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [role, generation, newPrompt, parentId, diagnosis],
  );
  return Number(rows[0].id);
}

/**
 * Update the win_rate of an existing prompt version.
 */
export async function updateWinRate(
  pool: Pool,
  versionId: number,
  winRate: number,
): Promise<void> {
  await pool.query(
    `UPDATE prompt_versions SET win_rate = $1 WHERE id = $2`,
    [winRate, versionId],
  );
}

/**
 * Full prompt surgery flow: diagnose, rewrite, and persist.
 * Returns the surgery result + the new version's DB id.
 */
export async function performSurgery(
  pool: Pool,
  input: SurgeryInput,
): Promise<SurgeryResult & { versionId: number; generation: number }> {
  const latest = await loadLatestPrompt(pool, input.role);
  const generation = latest ? latest.generation + 1 : 1;
  const parentId = latest?.id ?? null;

  const result = await runSurgeon(input);

  const versionId = await savePromptVersion(
    pool,
    input.role,
    result.newPrompt,
    result.diagnosis,
    parentId,
    generation,
  );

  return { ...result, versionId, generation };
}
