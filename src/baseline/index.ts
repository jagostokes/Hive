// baseline: a single strong model performing the same task end-to-end, run in
// parallel with the orchestrator for token/cost comparison.
export {
  runBaselineLane,
  type BaselineResult,
  type BaselineOptions,
  type BaselineToolCall,
} from "./baselineAgent.js";
