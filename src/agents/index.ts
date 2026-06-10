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
  adaptCachedSql,
  extractSql,
  type SqlAgentDeps,
  type SqlAgentResult,
  type SqlAgentSuccess,
  type AdaptCachedSqlDeps,
  type AdaptCachedSqlResult,
} from "./sqlAgent.js";
export { stripCodeFence, extractJsonObject } from "./parse.js";
export {
  runInsightAgent,
  type InsightAgentDeps,
  type InsightAgentResult,
  type InsightAgentSuccess,
} from "./insightAgent.js";
export {
  runDashboardPlanAgent,
  type DashboardPlanAgentDeps,
  type DashboardPlanAgentResult,
  type DashboardPlanAgentSuccess,
} from "./dashboardPlanAgent.js";
export {
  runCodeGenAgent,
  type CodeGenAgentDeps,
  type CodeGenAgentResult,
  type CodeGenAgentSuccess,
} from "./codeGenAgent.js";
export {
  runCodeEditAgent,
  type CodeEditAgentDeps,
  type CodeEditAgentResult,
  type CodeEditAgentSuccess,
} from "./codeEditAgent.js";
export {
  runPlanner,
  buildPlan,
  computeParallelGroups,
  type Plan,
  type PlanNode,
  type PlannerAgentDeps,
  type PlannerAgentResult,
} from "./plannerAgent.js";
export {
  runSurgeon,
  performSurgery,
  loadLatestPrompt,
  loadPromptHistory,
  savePromptVersion,
  updateWinRate,
  type PromptVersion,
  type SurgeryInput,
  type SurgeryResult,
} from "./promptSurgery.js";
export {
  researchTerm,
  growGlossary,
  glossaryHasTerm,
  insertGlossaryEntry,
  detectUnknownTerms,
  storeLearnedExample,
  loadLearnedExamples,
  type ResearchInput,
  type ResearchResult,
} from "./glossaryGrowth.js";
