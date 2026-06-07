// Tiny typed client around the Hono API. SSE is consumed via the native
// EventSource on the same origin (Vite proxies /api → the Hono server in dev).

export type LaneId = "brain" | "baseline";

export interface BrainAgent {
  role: string; // ModelRole — kept loose so the UI doesn't depend on the backend enum
  slug: string;
  label: string;
  params: string | null; // e.g. "30B" — null when unknown
}

export interface BaselineAgent extends BrainAgent {}

export interface ModelsResponse {
  brain: BrainAgent[];
  baseline: BaselineAgent;
}

export interface LedgerEntry {
  role: string;
  model: string;
  lane: LaneId;
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
  byLane: Record<LaneId, LaneTotals>;
}

export interface LaneState {
  status: "pending" | "running" | "complete" | "error";
  startedAt: number | null;
  finishedAt: number | null;
  completedRoles: string[];
  cachedRoles: string[];
  activeRole: string | null;
  html: string | null;
  reason?: string;
}

export interface RunEvent {
  brain: LaneState;
  baseline: LaneState;
  ledger: LedgerEntry[];
  totals: Totals | null;
}

export async function fetchModels(): Promise<ModelsResponse> {
  const r = await fetch("/api/models");
  if (!r.ok) throw new Error(`/api/models failed: ${r.status}`);
  return r.json();
}

export async function startRun(question: string): Promise<string> {
  const r = await fetch("/api/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question }),
  });
  if (!r.ok) throw new Error(`/api/run failed: ${r.status}`);
  const data = (await r.json()) as { runId: string };
  return data.runId;
}

export function subscribeRun(
  runId: string,
  onEvent: (e: RunEvent) => void,
  onError?: (err: Error) => void,
): () => void {
  const es = new EventSource(`/api/run/${runId}/events`);
  es.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data));
    } catch (err) {
      onError?.(err as Error);
    }
  };
  es.onerror = () => {
    // EventSource will auto-retry; surface as a soft error and let consumers decide.
    onError?.(new Error("event stream interrupted"));
  };
  return () => es.close();
}

export function htmlDownloadUrl(runId: string, lane: LaneId): string {
  return `/api/run/${runId}/html/${lane}`;
}

export async function fetchThesis(): Promise<string> {
  const r = await fetch("/api/thesis");
  if (!r.ok) throw new Error(`/api/thesis failed: ${r.status}`);
  return r.text();
}
