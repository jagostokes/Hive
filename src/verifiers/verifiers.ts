// verifiers: objective, deterministic checks of sub-agent output. A verified
// failure (ok:false + reason) is what triggers a retry/escalation; the reason is
// fed back so the agent can self-correct. PURE functions — NO model calls
// anywhere in here. (sqlVerifier does read-only DB I/O; the rest are pure compute.)
import ts from "typescript";
import type { ResultRow, ColumnDictEntry } from "../context/index.js";

export interface VerifierResult {
  ok: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// 1. sqlVerifier — execute the SQL read-only and gate on rows returned.
// ---------------------------------------------------------------------------

// Minimal structural shape of a pg Pool: enough to acquire a client, run a
// statement, and release. The real `pg` Pool satisfies this; tests inject a fake
// so the verifier is unit-testable without a live database.
export interface QueryResultLike {
  rows: unknown[];
  rowCount: number | null;
}

export interface PoolClientLike {
  query(text: string): Promise<QueryResultLike>;
  release(): void;
}

export interface PoolLike {
  connect(): Promise<PoolClientLike>;
}

export interface SqlVerifierOptions {
  // Reject results larger than this — an implausibly large result usually means
  // a missing filter/join, not an answer. Configurable per call.
  maxRows?: number;
}

const DEFAULT_MAX_ROWS = 100_000;

/**
 * Executes `sql` inside a READ ONLY transaction (rolled back afterwards) and
 * verifies it produced a usable result.
 *   ok=false if: it errors (reason = DB error message), returns 0 rows, or
 *   returns more than `maxRows` rows.
 * The read-only transaction means any write/DDL statement fails at the database
 * and is reported via its error message — the verifier makes no assumptions.
 */
export async function sqlVerifier(
  sql: string,
  db: PoolLike,
  opts: SqlVerifierOptions = {},
): Promise<VerifierResult> {
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;

  if (!sql || sql.trim().length === 0) {
    return { ok: false, reason: "empty SQL" };
  }

  let client: PoolClientLike;
  try {
    client = await db.connect();
  } catch (err) {
    return { ok: false, reason: errMessage(err) };
  }

  try {
    await client.query("begin transaction read only");
    const result = await client.query(sql);
    // Best-effort rollback; the transaction is read-only so this is just cleanup.
    await safeRollback(client);

    const count = result.rowCount ?? result.rows?.length ?? 0;
    if (count === 0) {
      return { ok: false, reason: "query returned 0 rows" };
    }
    if (count > maxRows) {
      return {
        ok: false,
        reason: `query returned ${count} rows, exceeding the cap of ${maxRows}`,
      };
    }
    return { ok: true };
  } catch (err) {
    await safeRollback(client);
    return { ok: false, reason: errMessage(err) };
  } finally {
    try {
      client.release();
    } catch {
      /* ignore release errors */
    }
  }
}

async function safeRollback(client: PoolClientLike): Promise<void> {
  try {
    await client.query("rollback");
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// 2. insightVerifier — cheap anti-hallucination: every number the insight cites
//    must appear in the result data (lenient on rounding).
// ---------------------------------------------------------------------------

interface CitedNumber {
  value: number;
  decimals: number;
  raw: string;
}

/**
 * ok=false if `insightText` cites a number that does not appear (within rounding
 * tolerance) anywhere in `resultRows`. Leniency: a cited number matches a data
 * value if it equals it after rounding to the cited number's precision, or is
 * within ~1% of it (covers thousands-rounding and display rounding).
 */
export function insightVerifier(
  insightText: string,
  resultRows: ResultRow[],
): VerifierResult {
  const cited = extractCitedNumbers(insightText);
  if (cited.length === 0) {
    // No numeric claims to hallucinate.
    return { ok: true };
  }

  const dataNumbers = collectNumbers(resultRows);
  if (dataNumbers.length === 0) {
    return {
      ok: false,
      reason: `insight cites numbers (${cited
        .map((c) => c.raw)
        .join(", ")}) but the result data contains none`,
    };
  }

  const unsupported = cited.filter(
    (c) => !dataNumbers.some((d) => numbersMatch(c, d)),
  );

  if (unsupported.length > 0) {
    return {
      ok: false,
      reason: `insight cites number(s) not present in the data: ${unsupported
        .map((c) => c.raw)
        .join(", ")}`,
    };
  }
  return { ok: true };
}

// Matches integers/decimals with optional thousands separators, leading currency
// sign, and trailing percent. Examples: 12,000  -3.5  $15400.25  42%
const NUMBER_RE = /-?\$?\d[\d,]*(?:\.\d+)?%?/g;

function extractCitedNumbers(text: string): CitedNumber[] {
  const out: CitedNumber[] = [];
  const matches = text.match(NUMBER_RE) ?? [];
  for (const raw of matches) {
    const cleaned = raw.replace(/[$,%]/g, "");
    const value = Number(cleaned);
    if (!Number.isFinite(value)) continue;
    const dot = cleaned.indexOf(".");
    const decimals = dot === -1 ? 0 : cleaned.length - dot - 1;
    out.push({ value, decimals, raw });
  }
  return out;
}

function collectNumbers(value: unknown, acc: number[] = []): number[] {
  if (typeof value === "number") {
    if (Number.isFinite(value)) acc.push(value);
  } else if (typeof value === "string") {
    const cleaned = value.replace(/[$,%]/g, "").trim();
    if (cleaned !== "" && Number.isFinite(Number(cleaned))) acc.push(Number(cleaned));
  } else if (Array.isArray(value)) {
    for (const v of value) collectNumbers(v, acc);
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) collectNumbers(v, acc);
  }
  return acc;
}

function numbersMatch(cited: CitedNumber, data: number): boolean {
  if (cited.value === data) return true;
  // Tolerance: half a unit at the cited precision (display rounding) OR ~1%
  // relative (covers rounding to thousands and float noise).
  const precisionTol = 0.5 * Math.pow(10, -cited.decimals);
  const relativeTol = Math.abs(data) * 0.01;
  const tol = Math.max(precisionTol, relativeTol) + 1e-9;
  return Math.abs(cited.value - data) <= tol;
}

// ---------------------------------------------------------------------------
// 3. planVerifier — every column the dashboard plan references must exist in the
//    result data.
// ---------------------------------------------------------------------------

// Plan keys whose string value(s) name a data column. Covers common chart-spec
// and charting-library conventions (vega-lite `field`, recharts `dataKey`, ...).
const COLUMN_REF_KEYS = new Set([
  "x",
  "y",
  "series",
  "color",
  "group",
  "groupby",
  "category",
  "value",
  "values",
  "size",
  "field",
  "fields",
  "columns",
  "dimensions",
  "measures",
  "xkey",
  "ykey",
  "datakey",
  "namekey",
  "anglekey",
]);

export type ResultSchema =
  | string[]
  | ColumnDictEntry[]
  | ResultRow
  | ResultRow[];

/**
 * ok=false if `dashboardPlan` references any column/field absent from the result
 * data. Only values under known column-reference keys (x, y, field, dataKey, …)
 * are checked; free-text keys like `title` and the chart `type` are ignored.
 */
export function planVerifier(
  dashboardPlan: unknown,
  resultSchema: ResultSchema,
): VerifierResult {
  const available = normalizeSchemaColumns(resultSchema);
  if (available.size === 0) {
    return { ok: false, reason: "result data has no columns to validate against" };
  }

  const referenced = collectPlanColumnRefs(dashboardPlan);
  const missing = referenced.filter((ref) => !available.has(ref.toLowerCase()));

  if (missing.length > 0) {
    return {
      ok: false,
      reason: `plan references column(s) not in the data: ${[...new Set(missing)].join(
        ", ",
      )}. Available: ${[...available].join(", ")}`,
    };
  }
  return { ok: true };
}

function normalizeSchemaColumns(schema: ResultSchema): Set<string> {
  const names = new Set<string>();
  const add = (n: unknown): void => {
    if (typeof n === "string" && n.trim() !== "") names.add(n.toLowerCase());
  };

  if (Array.isArray(schema)) {
    for (const item of schema) {
      if (typeof item === "string") add(item);
      else if (item && typeof item === "object") {
        // ColumnDictEntry { name } or a sample ResultRow (use its keys).
        if ("name" in item && typeof (item as ColumnDictEntry).name === "string") {
          add((item as ColumnDictEntry).name);
        } else {
          for (const k of Object.keys(item)) add(k);
        }
      }
    }
  } else if (schema && typeof schema === "object") {
    for (const k of Object.keys(schema)) add(k);
  }
  return names;
}

function collectPlanColumnRefs(plan: unknown, acc: string[] = []): string[] {
  if (Array.isArray(plan)) {
    for (const item of plan) collectPlanColumnRefs(item, acc);
  } else if (plan && typeof plan === "object") {
    for (const [key, value] of Object.entries(plan)) {
      if (COLUMN_REF_KEYS.has(key.toLowerCase())) {
        if (typeof value === "string") acc.push(value);
        else if (Array.isArray(value)) {
          for (const v of value) if (typeof v === "string") acc.push(v);
        }
      }
      // Recurse to catch nested encodings (e.g. { encoding: { x: { field } } }).
      if (value && typeof value === "object") collectPlanColumnRefs(value, acc);
    }
  }
  return acc;
}

// ---------------------------------------------------------------------------
// 4. renderVerifier — objective build check of the generated dashboard HTML.
//    Both lanes emit a self-contained HTML fragment (markup + an inline <script>
//    that draws charts with Chart.js). ok=false if it is empty, carries no
//    visualization, or any inline <script> has a JavaScript syntax error.
// ---------------------------------------------------------------------------

// A real dashboard must contain at least one of these — a chart, an inline
// drawing, or a data table. Otherwise it's just prose / an empty shell.
const VISUALIZATION_RE = /<canvas\b|<svg\b|new\s+Chart\s*\(|<table\b/i;

// Inline <script> blocks (excludes <script src="...">), captured for syntax
// checking. The model's chart code lives here.
const INLINE_SCRIPT_RE = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

/**
 * Verifies the generated dashboard HTML builds:
 *   - non-empty,
 *   - contains a visualization (canvas / svg / Chart.js / table),
 *   - every inline <script> is syntactically valid JavaScript (parsed, NOT
 *     executed — it references browser globals like `document`/`Chart` that only
 *     exist at render time; the host's fallback covers runtime issues).
 * reason = the first failing check's message.
 */
export function renderVerifier(html: string): VerifierResult {
  if (!html || html.trim() === "") {
    return { ok: false, reason: "dashboard HTML is empty" };
  }

  if (!VISUALIZATION_RE.test(html)) {
    return {
      ok: false,
      reason: "no visualization found — expected a <canvas> (Chart.js), <svg>, or <table>",
    };
  }

  let match: RegExpExecArray | null;
  INLINE_SCRIPT_RE.lastIndex = 0;
  while ((match = INLINE_SCRIPT_RE.exec(html)) !== null) {
    const script = match[1];
    if (!script || script.trim() === "") continue;
    const syntaxError = findScriptSyntaxError(script);
    if (syntaxError) {
      return { ok: false, reason: `inline script syntax error: ${syntaxError}` };
    }
  }

  return { ok: true };
}

// Syntax-only check of an inline script via the TS compiler. We transpile (which
// surfaces syntactic errors) without executing, so references to runtime globals
// (document, window, Chart) are fine.
function findScriptSyntaxError(script: string): string | null {
  let transpiled: ts.TranspileOutput;
  try {
    transpiled = ts.transpileModule(script, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
      },
      reportDiagnostics: true,
      fileName: "dashboard.js",
    });
  } catch (err) {
    return errMessage(err);
  }
  // Only count diagnostics anchored in the script itself (real syntax errors);
  // option/global diagnostics (no `file`) are not about the code.
  const fatal = (transpiled.diagnostics ?? []).find(
    (d) => d.category === ts.DiagnosticCategory.Error && d.file !== undefined,
  );
  return fatal ? ts.flattenDiagnosticMessageText(fatal.messageText, "\n") : null;
}

// ---------------------------------------------------------------------------

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
