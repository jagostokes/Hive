/**
 * Unit-ish tests for the four verifiers. One passing + one failing example each.
 * No DB and no model calls: sqlVerifier is exercised with an in-memory fake pool
 * (offline). Prints PASS/FAIL per case and exits non-zero on any failure.
 *
 * Run: npm run test:verifiers
 */
import {
  sqlVerifier,
  insightVerifier,
  planVerifier,
  renderVerifier,
  type PoolLike,
  type QueryResultLike,
  type VerifierResult,
} from "../src/verifiers/index.js";

let passed = 0;
let failed = 0;

function check(name: string, got: VerifierResult, wantOk: boolean): void {
  const ok = got.ok === wantOk;
  if (ok) {
    passed++;
    console.log(`PASS  ${name}  -> ok=${got.ok}${got.reason ? ` reason="${got.reason}"` : ""}`);
  } else {
    failed++;
    console.error(
      `FAIL  ${name}  -> expected ok=${wantOk}, got ok=${got.ok}` +
        `${got.reason ? ` reason="${got.reason}"` : ""}`,
    );
  }
}

// A fake pg Pool: every connected client returns the configured result (or
// throws the configured error) for the data query, ignoring the BEGIN/ROLLBACK.
function fakePool(behavior: {
  rows?: unknown[];
  rowCount?: number;
  throwOn?: string;
}): PoolLike {
  return {
    async connect() {
      return {
        async query(text: string): Promise<QueryResultLike> {
          const t = text.trim().toLowerCase();
          if (t.startsWith("begin") || t.startsWith("rollback")) {
            return { rows: [], rowCount: 0 };
          }
          if (behavior.throwOn) throw new Error(behavior.throwOn);
          const rows = behavior.rows ?? [];
          return { rows, rowCount: behavior.rowCount ?? rows.length };
        },
        release() {},
      };
    },
  };
}

async function main(): Promise<void> {
  // 1. sqlVerifier ---------------------------------------------------------
  check(
    "sqlVerifier / good (returns rows)",
    await sqlVerifier("select region, revenue from sales", fakePool({ rows: [{ region: "N", revenue: 1 }] })),
    true,
  );
  check(
    "sqlVerifier / bad (0 rows)",
    await sqlVerifier("select * from sales where 1=0", fakePool({ rows: [] })),
    false,
  );
  check(
    "sqlVerifier / bad (DB error from a write in a read-only tx)",
    await sqlVerifier("drop table sales", fakePool({ throwOn: "cannot execute DROP TABLE in a read-only transaction" })),
    false,
  );
  check(
    "sqlVerifier / bad (implausibly large row count)",
    await sqlVerifier("select * from events", fakePool({ rowCount: 5_000_000, rows: [] }), { maxRows: 100_000 }),
    false,
  );

  // 2. insightVerifier -----------------------------------------------------
  const rows = [
    { region: "North", revenue: 12000.5, order_count: 320 },
    { region: "South", revenue: 9800, order_count: 210 },
  ];
  check(
    "insightVerifier / good (numbers present, rounding lenient)",
    // 12,000 rounds from 12000.5; 320 is exact.
    insightVerifier("The North region led with $12,000 across 320 orders.", rows),
    true,
  );
  check(
    "insightVerifier / bad (hallucinated number)",
    insightVerifier("Revenue surged to $87,654 last quarter.", rows),
    false,
  );

  // 3. planVerifier --------------------------------------------------------
  const resultColumns = [
    { name: "region", type: "string" },
    { name: "revenue", type: "number" },
  ];
  check(
    "planVerifier / good (refs existing columns)",
    planVerifier({ type: "bar", x: "region", y: "revenue", title: "Revenue by Region" }, resultColumns),
    true,
  );
  check(
    "planVerifier / bad (refs missing column)",
    planVerifier({ type: "bar", x: "region", y: "profit", title: "Profit" }, resultColumns),
    false,
  );

  // 4. renderVerifier ------------------------------------------------------
  const goodDashboard = `
    <div class="hive-card">
      <h3>Revenue by Region</h3>
      <div style="position:relative;height:260px"><canvas id="c1"></canvas></div>
      <script>
        const rows = DASHBOARD_DATA.charts[0].rows;
        new Chart(document.getElementById("c1").getContext("2d"), {
          type: "bar",
          data: { labels: rows.map(r => r.region), datasets: [{ data: rows.map(r => Number(r.revenue)) }] }
        });
      </script>
    </div>
  `;
  const badDashboardSyntax = `
    <div class="hive-card"><canvas id="c1"></canvas>
      <script>const rows = [1, 2, 3 ; new Chart()</script>
    </div>
  `;
  const badDashboardNoViz = `<div class="hive-card"><h3>Revenue</h3><p>Total was 1000.</p></div>`;
  check("renderVerifier / good (valid HTML + chart, syntactically sound script)", renderVerifier(goodDashboard), true);
  check("renderVerifier / bad (inline script syntax error)", renderVerifier(badDashboardSyntax), false);
  check("renderVerifier / bad (no visualization)", renderVerifier(badDashboardNoViz), false);

  // Summary ---------------------------------------------------------------
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
