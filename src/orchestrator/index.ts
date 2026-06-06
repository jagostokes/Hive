// orchestrator: decomposes the question into sub-agents, runs the capped
// retry/escalate loop (2 cheap + 1 escalation, then stop), and assembles results.
export {
  runBrainLane,
  type BrainResult,
  type BrainOptions,
  type LaneResult,
  type DashboardSpec,
  type DashboardChart,
} from "./orchestrator.js";
