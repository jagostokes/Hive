// Map each brain agent role to a bee sprite (from hive-assets) + a human label.
// The role list is not hardcoded — we receive it from /api/models — but we DO
// have a stable map from known role ids to bee sprites so the swarm is
// consistent across runs.
import type { BeeRole } from "../components/sprites/SpriteBee";

export const ROLE_TO_SPRITE: Record<string, BeeRole> = {
  // Thematic mapping to the colored swarm bees in hive-assets/bees/.
  planner: "planner", // blue · planning
  sqlGen: "fetcher", // gold · fetches data via SQL
  insight: "charter", // orange · charts insights from rows
  dashboardPlan: "orchestrator", // amber · coordinates dashboard layout
  codeGen: "writer", // red · writes the dashboard code
  codeEdit: "qa", // green · QA / repairs broken code
};

export const ROLE_LABEL: Record<string, string> = {
  planner: "Planner",
  sqlGen: "SQL Author",
  insight: "Insight",
  dashboardPlan: "Dashboard Plan",
  codeGen: "Code Gen",
  codeEdit: "Code Edit",
  // baseline + escalations get a generic label if shown
  sqlEscalation: "SQL Escalation",
  baseline: "Baseline",
  embedding: "Embedding",
};

const SPRITE_CYCLE: BeeRole[] = [
  "planner",
  "fetcher",
  "charter",
  "orchestrator",
  "writer",
  "qa",
];

export function spriteForRole(role: string, index = 0): BeeRole {
  return ROLE_TO_SPRITE[role] ?? SPRITE_CYCLE[index % SPRITE_CYCLE.length];
}

export function labelForRole(role: string): string {
  return ROLE_LABEL[role] ?? role;
}

/** Compute drop level (0..4) from completed/total counts. */
export function dropLevelFromProgress(
  completed: number,
  total: number,
  finished: boolean,
): 0 | 1 | 2 | 3 | 4 {
  if (finished) return 4;
  if (total <= 0 || completed <= 0) return 0;
  const frac = completed / total;
  if (frac >= 0.75) return 3;
  if (frac >= 0.5) return 2;
  if (frac >= 0.25) return 1;
  return 0;
}

export function usd(amount: number): string {
  if (!isFinite(amount)) return "$0.0000";
  if (amount === 0) return "$0.0000";
  if (amount < 0.0001) return "<$0.0001";
  if (amount < 1) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

export function compactNum(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
