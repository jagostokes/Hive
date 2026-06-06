// context: fetch the ground truth once per run and expose role-scoped accessors
// that each return only the slice one agent needs. Pure data assembly — no model
// calls anywhere in here.
export {
  buildContext,
  createContextProvider,
  fetchGroundTruth,
  fetchGlossary,
  type ContextProvider,
  type RawContext,
  type GlossaryEntry,
  type ResultRow,
  type ColumnDictEntry,
  type PlannerContext,
  type SqlContext,
  type InsightContext,
  type DashboardPlanContext,
  type CodeGenContext,
  type CodeEditContext,
} from "./contextProvider.js";
