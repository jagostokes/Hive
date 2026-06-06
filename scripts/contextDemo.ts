/**
 * Eyeball demo: prints what EACH role-scoped accessor returns for a dummy
 * question / result rows, so you can verify each role gets only its slice.
 *
 * Run: npm run demo:context
 *
 * Uses an injected dummy ground truth (deterministic, no DB needed) for the
 * accessor walkthrough. If DATABASE_URL is set, it also runs a live
 * introspection against InsForge to prove the real introspector works.
 */
import "dotenv/config";
import {
  createContextProvider,
  buildContext,
  type RawContext,
  type ResultRow,
} from "../src/context/index.js";
import { closePool } from "../src/db/index.js";

function section(title: string): void {
  console.log("\n" + "=".repeat(72));
  console.log(title);
  console.log("=".repeat(72));
}

function show(label: string, note: string, value: unknown): void {
  console.log(`\n--- ${label} ---`);
  console.log(`(${note})`);
  console.log(JSON.stringify(value, null, 2));
}

// A dummy domain schema with more than SMALL_SCHEMA_MAX_TABLES (6) tables so the
// forSql relevance filtering is visible. None of these names are known to the
// library — they are just demo data.
const dummyRaw: RawContext = {
  schema: {
    tables: [
      {
        schema: "public",
        name: "customers",
        columns: [
          { name: "id", type: "int8", nullable: false },
          { name: "name", type: "text", nullable: false },
          { name: "region", type: "text", nullable: true },
        ],
      },
      {
        schema: "public",
        name: "orders",
        columns: [
          { name: "id", type: "int8", nullable: false },
          { name: "customer_id", type: "int8", nullable: false },
          { name: "amount", type: "numeric", nullable: false },
          { name: "created_at", type: "timestamptz", nullable: true },
        ],
      },
      {
        schema: "public",
        name: "order_items",
        columns: [
          { name: "id", type: "int8", nullable: false },
          { name: "order_id", type: "int8", nullable: false },
          { name: "product_id", type: "int8", nullable: false },
          { name: "quantity", type: "int4", nullable: false },
        ],
      },
      {
        schema: "public",
        name: "products",
        columns: [
          { name: "id", type: "int8", nullable: false },
          { name: "name", type: "text", nullable: false },
          { name: "price", type: "numeric", nullable: false },
        ],
      },
      {
        schema: "public",
        name: "payments",
        columns: [
          { name: "id", type: "int8", nullable: false },
          { name: "order_id", type: "int8", nullable: false },
          { name: "amount", type: "numeric", nullable: false },
        ],
      },
      {
        schema: "public",
        name: "regions",
        columns: [
          { name: "id", type: "int8", nullable: false },
          { name: "region", type: "text", nullable: false },
          { name: "manager", type: "text", nullable: true },
        ],
      },
      {
        schema: "public",
        name: "suppliers",
        columns: [
          { name: "id", type: "int8", nullable: false },
          { name: "name", type: "text", nullable: false },
        ],
      },
      {
        schema: "public",
        name: "inventory",
        columns: [
          { name: "id", type: "int8", nullable: false },
          { name: "product_id", type: "int8", nullable: false },
          { name: "on_hand", type: "int4", nullable: false },
        ],
      },
    ],
  },
  glossary: [
    {
      id: 1,
      term: "revenue",
      definition: "Total money collected from paid orders.",
      sqlExpression: "sum(amount)",
    },
    {
      id: 2,
      term: "active_customer",
      definition: "A customer with at least one order in the last 90 days.",
      sqlExpression: "status = 'active'",
    },
    {
      id: 3,
      term: "churn",
      definition: "A customer who stopped ordering. Narrative metric, no SQL.",
      sqlExpression: null,
    },
  ],
};

const dummySubQuestion = "What is total revenue by region?";

const dummyResultRows: ResultRow[] = [
  { region: "North", revenue: 12000.5, order_count: 320 },
  { region: "South", revenue: 9800, order_count: 210 },
  { region: "East", revenue: 15400.25, order_count: 410 },
  { region: "West", revenue: 7600, order_count: 150 },
];

const dummyChartPlan = {
  chartType: "bar",
  x: "region",
  y: "revenue",
  title: "Revenue by Region",
};

const dummyComponent = `export function Chart({ data }) {
  return <Bar data={data.map(d => d.revenue)} />;
}`;

const dummyError =
  "TypeError: Cannot read properties of undefined (reading 'map')";

async function main(): Promise<void> {
  const ctx = createContextProvider(dummyRaw);

  section("Role-scoped accessors (dummy ground truth: 8 tables, 3 glossary rows)");

  show(
    "forPlanner()",
    "full schema (all 8 tables) + full glossary (all 3 rows)",
    ctx.forPlanner(),
  );

  show(
    `forSql(${JSON.stringify(dummySubQuestion)})`,
    "only region-relevant tables (schema > 6 tables) + ONLY glossary rows with a sql_expression (churn dropped)",
    ctx.forSql(dummySubQuestion),
  );

  show(
    "forInsight(resultRows)",
    "column dictionary for the data + the SINGLE matched metric definition (revenue); NO DDL, NO full glossary",
    ctx.forInsight(dummyResultRows),
  );

  show(
    "forDashboardPlan(resultRows)",
    "result columns + a few sample rows; NOTHING about the source schema or glossary",
    ctx.forDashboardPlan(dummyResultRows),
  );

  show(
    "forCodeGen(plan, data)",
    "the chart plan + the data only; no schema, no glossary",
    ctx.forCodeGen(dummyChartPlan, dummyResultRows),
  );

  show(
    "forCodeEdit(component, error)",
    "the component + the render error only; no schema, no glossary, no data",
    ctx.forCodeEdit(dummyComponent, dummyError),
  );

  // Optional: prove the real introspector + glossary fetch work against InsForge.
  if (process.env.DATABASE_URL) {
    section("Live InsForge introspection (DATABASE_URL detected)");
    try {
      const live = await buildContext();
      const planner = live.forPlanner();
      console.log(
        `\nDomain tables discovered (infra tables excluded): ${planner.schema.tables.length}`,
      );
      console.log(JSON.stringify(planner, null, 2));
    } catch (err) {
      console.error(
        "Live introspection failed:",
        err instanceof Error ? err.message : err,
      );
    } finally {
      await closePool();
    }
  } else {
    section("Live InsForge introspection skipped");
    console.log("Set DATABASE_URL in .env to also run a live introspection.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
