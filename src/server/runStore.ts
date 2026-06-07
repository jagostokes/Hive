// runStore: in-memory state for live runs the UI is observing. One run = one
// brain lane + one baseline lane started from the same question, sharing the
// global ledger (each entry tagged by lane). Subscribers receive ledger snapshots
// + lane completion events over a simple event emitter.
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { LedgerEntry, Totals } from "../models/index.js";

export type LaneId = "brain" | "baseline";

export interface LaneState {
  status: "pending" | "running" | "complete" | "error";
  startedAt: number | null;
  finishedAt: number | null;
  /** Roles that have produced at least one ledger entry (i.e. completed at least once). */
  completedRoles: string[];
  /** Roles that were SKIPPED because cache served the result (full-skip only,
   *  not "cache-adapted" which still calls the model). Populated after the
   *  brain run finishes. The UI treats these as "ran" (full color) and shows a
   *  "stepped cached" subtitle. */
  cachedRoles: string[];
  /** Currently-running roles (rough heuristic: most recent ledger entry's role). */
  activeRole: string | null;
  html: string | null;
  reason?: string;
}

export interface RunState {
  id: string;
  question: string;
  createdAt: number;
  brain: LaneState;
  baseline: LaneState;
  ledger: LedgerEntry[];
  totals: Totals | null;
}

const emptyLane = (): LaneState => ({
  status: "pending",
  startedAt: null,
  finishedAt: null,
  completedRoles: [],
  cachedRoles: [],
  activeRole: null,
  html: null,
});

class RunStore {
  private runs = new Map<string, RunState>();
  emitter = new EventEmitter();

  create(question: string): RunState {
    const run: RunState = {
      id: randomUUID(),
      question,
      createdAt: Date.now(),
      brain: emptyLane(),
      baseline: emptyLane(),
      ledger: [],
      totals: null,
    };
    this.runs.set(run.id, run);
    return run;
  }

  get(id: string): RunState | undefined {
    return this.runs.get(id);
  }

  update(id: string, patch: (run: RunState) => void): void {
    const run = this.runs.get(id);
    if (!run) return;
    patch(run);
    this.emitter.emit(`run:${id}`, run);
  }

  close(id: string): void {
    this.runs.delete(id);
  }
}

export const runStore = new RunStore();
