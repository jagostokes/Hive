// agents: specialized sub-agents that each handle one part of the decomposed
// question, running on the cheap model by default. All follow the runner
// template: own system prompt -> scoped context -> cheap model -> verify ->
// retry once -> escalate once -> stop.
export {
  runAgent,
  type AgentSpec,
  type AgentResult,
  type AgentSuccess,
  type AgentFailure,
  type Attempt,
  type AttemptFeedback,
  type VerifyOutcome,
} from "./runner.js";
export {
  runSqlAgent,
  extractSql,
  type SqlAgentDeps,
  type SqlAgentResult,
  type SqlAgentSuccess,
} from "./sqlAgent.js";
