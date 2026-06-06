import { getPool } from "../db/client.js";
import {
  introspectSchema,
  type SchemaDescription,
  type TableInfo,
} from "../db/introspect.js";
import type { Pool } from "pg";

// The app's own infrastructure tables. Excluded from the *domain* schema the
// agents reason over. These are infra names known to this layer, not domain
// assumptions.
const INTERNAL_TABLES = ["query_cache", "business_glossary"];

// A schema with at most this many tables is cheap enough to hand to the SQL
// agent whole; above it we filter to the relevant tables.
const SMALL_SCHEMA_MAX_TABLES = 6;

// How many sample rows the dashboard planner sees.
const DASHBOARD_SAMPLE_ROWS = 3;

export interface GlossaryEntry {
  id: number;
  term: string;
  definition: string;
  sqlExpression: string | null;
}

export interface RawContext {
  schema: SchemaDescription;
  glossary: GlossaryEntry[];
}

export type ResultRow = Record<string, unknown>;

export interface ColumnDictEntry {
  name: string;
  type: string;
}

export interface PlannerContext {
  schema: SchemaDescription;
  glossary: GlossaryEntry[];
}

export interface SqlContext {
  subQuestion: string;
  tables: TableInfo[];
  glossary: GlossaryEntry[];
}

export interface InsightContext {
  columns: ColumnDictEntry[];
  metric: GlossaryEntry | null;
}

export interface DashboardPlanContext {
  columns: ColumnDictEntry[];
  sampleRows: ResultRow[];
}

export interface CodeGenContext {
  plan: unknown;
  data: ResultRow[];
}

export interface CodeEditContext {
  component: string;
  error: string;
}

export interface ContextProvider {
  forPlanner(): PlannerContext;
  forSql(subQuestion: string): SqlContext;
  forInsight(resultRows: ResultRow[]): InsightContext;
  forDashboardPlan(resultRows: ResultRow[]): DashboardPlanContext;
  forCodeGen(plan: unknown, data: ResultRow[]): CodeGenContext;
  forCodeEdit(component: string, error: string): CodeEditContext;
}

interface GlossaryRow {
  id: number | string;
  term: string;
  definition: string;
  sql_expression: string | null;
}

export async function fetchGlossary(pool: Pool): Promise<GlossaryEntry[]> {
  const { rows } = await pool.query<GlossaryRow>(
    `select id, term, definition, sql_expression from business_glossary order by id`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    term: r.term,
    definition: r.definition,
    sqlExpression: r.sql_expression,
  }));
}

/**
 * Fetches the ground truth ONCE: the introspected domain schema plus all
 * glossary rows. Pure data — no model calls.
 */
export async function fetchGroundTruth(pool?: Pool): Promise<RawContext> {
  const p = pool ?? getPool();
  const schema = await introspectSchema(p, { excludeTables: INTERNAL_TABLES });
  const glossary = await fetchGlossary(p);
  return { schema, glossary };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function singularize(token: string): string {
  return token.endsWith("s") ? token.slice(0, -1) : token;
}

function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singularize);
  return new Set(tokens);
}

function tableMatches(table: TableInfo, questionTokens: Set<string>): boolean {
  const names = [table.name, ...table.columns.map((c) => c.name)];
  for (const name of names) {
    for (const part of name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
      if (questionTokens.has(singularize(part))) return true;
    }
  }
  return false;
}

function inferType(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

// Build a compact name->type dictionary for a set of result rows, inferring each
// column's type from the first non-null value seen.
function columnDictionary(rows: ResultRow[]): ColumnDictEntry[] {
  const types = new Map<string, string>();
  const order: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!types.has(key)) {
        types.set(key, "null");
        order.push(key);
      }
      if (types.get(key) === "null" && row[key] !== null && row[key] !== undefined) {
        types.set(key, inferType(row[key]));
      }
    }
  }
  return order.map((name) => ({ name, type: types.get(name) ?? "null" }));
}

/**
 * Builds the role-scoped context accessors from already-fetched raw data. Pure:
 * no DB access, no model calls. The raw ground truth is held privately and each
 * accessor returns only the slice its role needs — scoping happens here, at the
 * accessor boundary, not in a single shared block.
 */
export function createContextProvider(raw: RawContext): ContextProvider {
  return {
    forPlanner(): PlannerContext {
      return { schema: clone(raw.schema), glossary: clone(raw.glossary) };
    },

    forSql(subQuestion: string): SqlContext {
      const all = raw.schema.tables;
      let tables: TableInfo[];
      if (all.length <= SMALL_SCHEMA_MAX_TABLES) {
        tables = all;
      } else {
        const tokens = tokenize(subQuestion);
        const matched = all.filter((t) => tableMatches(t, tokens));
        // Fall back to the whole schema rather than starving the SQL agent.
        tables = matched.length > 0 ? matched : all;
      }
      const glossary = raw.glossary.filter((g) => g.sqlExpression !== null);
      return {
        subQuestion,
        tables: clone(tables),
        glossary: clone(glossary),
      };
    },

    forInsight(resultRows: ResultRow[]): InsightContext {
      const columns = columnDictionary(resultRows);
      const columnNames = new Set(columns.map((c) => c.name.toLowerCase()));
      // The single metric in play: the first glossary term that names one of the
      // returned columns. No DDL, no full glossary.
      const metric =
        raw.glossary.find((g) => columnNames.has(g.term.toLowerCase())) ?? null;
      return { columns, metric: metric ? clone(metric) : null };
    },

    forDashboardPlan(resultRows: ResultRow[]): DashboardPlanContext {
      return {
        columns: columnDictionary(resultRows),
        sampleRows: clone(resultRows.slice(0, DASHBOARD_SAMPLE_ROWS)),
      };
    },

    forCodeGen(plan: unknown, data: ResultRow[]): CodeGenContext {
      return { plan: clone(plan), data: clone(data) };
    },

    forCodeEdit(component: string, error: string): CodeEditContext {
      return { component, error };
    },
  };
}

/**
 * Convenience: fetch the ground truth once and return a ready context provider.
 */
export async function buildContext(pool?: Pool): Promise<ContextProvider> {
  const raw = await fetchGroundTruth(pool);
  return createContextProvider(raw);
}
