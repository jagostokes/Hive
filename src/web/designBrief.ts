// web/designBrief: the shared "model HTML concept" both lanes follow so the
// generated dashboards look like one designed product. Both lanes now emit a
// self-contained HTML fragment (markup + an inline <script> that draws charts
// with Chart.js) rather than a React component — fewer moving parts than the old
// React/Babel/mount path, and full creative latitude over the layout.
//
// codeGen (brain) and the baseline strong model both receive DASHBOARD_DESIGN_BRIEF.
// codeGen additionally gets DASHBOARD_DATA_CONTRACT (it is handed real rows that
// the host also exposes as the global `DASHBOARD_DATA`); the baseline embeds its
// own tool results directly.

export const DASHBOARD_PALETTE = [
  "#4ade80",
  "#60a5fa",
  "#f59e0b",
  "#f472b6",
  "#22d3ee",
  "#a78bfa",
];

export const DASHBOARD_DESIGN_BRIEF = `DESIGN BRIEF — produce ONE polished, self-contained HTML dashboard fragment:
- Output an HTML FRAGMENT only: your markup plus ONE inline <script>. Do NOT include <!doctype>, <html>, <head>, <body>, or any <script src="..."> tags — the host page already loads Chart.js (global \`Chart\`) and paints the dark page background.
- Charts: use Chart.js via the global \`Chart\`. Create <canvas> elements. Pick the type by the data: a LINE for a trend over a date/time column, a DOUGHNUT for a share/part-of-whole breakdown, a BAR for comparing categories, and a KPI tile for a single scalar. Do NOT load any other chart library.
- Axis formatting: when the x values are dates/timestamps, format them to short readable labels (e.g. new Date(v).toLocaleDateString()) — never show raw ISO strings. When the metric is a whole-number count, use integer ticks (scales.y.ticks.precision = 0) so the axis isn't 0.1, 0.2, ….
- Layout: wrap cards in a container with style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px". Each card: background #11151f, 1px solid #232a36 border, border-radius 12px, padding 16px 18px, box-shadow 0 1px 2px rgba(0,0,0,.4). Give each card a title (color #e6e6e6, font-weight 600) and, when an insight is provided, a small muted caption (color #8b95a5, font-size 12px).
- Theme: text #e6e6e6, muted labels #8b95a5. Chart axes/gridlines should use #8b95a5 / #232a36. Series colors cycle through ["#4ade80","#60a5fa","#f59e0b","#f472b6","#22d3ee","#a78bfa"].
- Sizing (CRITICAL — get this exactly right): NEVER place a bare <canvas> in the card. ALWAYS wrap it: <div style="position:relative;height:260px"><canvas></canvas></div>, and ALWAYS pass Chart.js options { responsive:true, maintainAspectRatio:false }. Without BOTH the chart stretches to fill the page and renders unreadable. For value axes set scales.y.beginAtZero:true.
- KPI fallback: if a result is a single row OR a single numeric value, render a big KPI tile (a ~34px bold number + a muted label) instead of an empty chart. Never render "No data" when rows exist.
- Be defensive: coerce numeric-looking strings with Number(), and guard against missing/empty arrays so the dashboard always renders something meaningful.`;

export const DASHBOARD_DATA_CONTRACT = `DATA — the rows you must visualize are shown below under "DASHBOARD DATA" and are ALSO available to your inline script as the global \`DASHBOARD_DATA\`, with this shape:
{
  "title": string,
  "charts": [
    {
      "id": string,
      "question": string,                       // the sub-question this card answers
      "plan": { "type": string, "x"?: string, "y"?: string, "title"?: string },
      "rows": [ { "<column>": value, ... } ],    // the actual query result rows
      "insight"?: string                         // optional one-line takeaway -> caption
    }
  ]
}
Render one card per entry in DASHBOARD_DATA.charts, using plan.type/x/y to pick the chart and map \`rows\`. You may read the global \`DASHBOARD_DATA\` directly in your script (preferred) or inline the same values — either way the numbers must match the data shown.`;

// A complete, known-good reference fragment. It is data-driven off DASHBOARD_DATA
// and follows every rule above (grid of cards, fixed-height canvas wrappers,
// maintainAspectRatio:false, KPI tile for single-value results, bar/line/doughnut
// by plan.type, palette, insight captions). codeGen is told to ADAPT this, so even
// a fast model produces a correct, polished dashboard. This is the in-prompt "base
// example"; the same string could later be stored/retrieved from a DB examples
// table without changing the agents.
export const DASHBOARD_EXAMPLE = `<div id="hive-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px"></div>
<script>
(function () {
  const PALETTE = ["#4ade80","#60a5fa","#f59e0b","#f472b6","#22d3ee","#a78bfa"];
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const grid = document.getElementById("hive-grid");
  const charts = (window.DASHBOARD_DATA && window.DASHBOARD_DATA.charts) || [];

  charts.forEach((c, idx) => {
    const rows = Array.isArray(c.rows) ? c.rows : [];
    const card = document.createElement("div");
    card.style.cssText = "background:#11151f;border:1px solid #232a36;border-radius:12px;padding:16px 18px;box-shadow:0 1px 2px rgba(0,0,0,.4)";
    const title = document.createElement("h3");
    title.style.cssText = "margin:0 0 8px;font-size:15px;color:#e6e6e6;font-weight:600";
    title.textContent = (c.plan && c.plan.title) || c.question || "Result";
    card.appendChild(title);

    const keys = rows.length ? Object.keys(rows[0]) : [];
    const yKey = (c.plan && c.plan.y) || keys.find((k) => rows.every((r) => num(r[k]) !== null));
    const xKey = (c.plan && c.plan.x) || keys.find((k) => k !== yKey) || keys[0];

    const planType = (c.plan && c.plan.type) || "";
    const isKpi = /kpi|stat|single|value|number/i.test(planType) || (rows.length === 1 && yKey);
    if (isKpi && yKey) {
      const kpi = document.createElement("div");
      kpi.style.cssText = "font-size:34px;font-weight:700;color:" + PALETTE[idx % PALETTE.length];
      kpi.textContent = Number(rows[0][yKey]).toLocaleString();
      const lbl = document.createElement("div");
      lbl.style.cssText = "color:#8b95a5;font-size:13px;margin-top:4px";
      lbl.textContent = yKey;
      card.appendChild(kpi); card.appendChild(lbl);
    } else if (yKey) {
      const wrap = document.createElement("div");
      wrap.style.cssText = "position:relative;height:260px";
      const canvas = document.createElement("canvas");
      wrap.appendChild(canvas); card.appendChild(wrap);
      const type = /pie|doughnut|donut/i.test(planType) ? "doughnut"
        : /line|trend|time|date/i.test(planType) ? "line" : "bar";
      // Format date-like x values (ISO timestamps, dates) to short readable labels.
      const isDate = rows.length > 0
        && rows.every((r) => !isNaN(Date.parse(r[xKey])))
        && /[-/:T]/.test(String(rows[0][xKey]));
      const labels = rows.map((r) => isDate ? new Date(r[xKey]).toLocaleDateString() : String(r[xKey]));
      const values = rows.map((r) => num(r[yKey]));
      const allInt = values.every((v) => v !== null && Number.isInteger(v));
      const colors = rows.map((_, i) => PALETTE[i % PALETTE.length]);
      new Chart(canvas.getContext("2d"), {
        type,
        data: { labels, datasets: [{
          label: yKey, data: values,
          backgroundColor: type === "line" ? "transparent" : colors,
          borderColor: type === "line" ? PALETTE[idx % PALETTE.length] : colors,
          tension: 0.3, fill: false, pointRadius: type === "line" ? 3 : 0
        }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: type === "doughnut", labels: { color: "#e6e6e6" } } },
          scales: type === "doughnut" ? {} : {
            x: { ticks: { color: "#8b95a5", maxRotation: 0, autoSkip: true }, grid: { color: "#232a36" } },
            y: { beginAtZero: true, ticks: Object.assign({ color: "#8b95a5" }, allInt ? { precision: 0 } : {}), grid: { color: "#232a36" } }
          }
        }
      });
    }

    if (c.insight) {
      const cap = document.createElement("div");
      cap.style.cssText = "color:#8b95a5;font-size:12px;margin-top:8px";
      cap.textContent = c.insight;
      card.appendChild(cap);
    }
    grid.appendChild(card);
  });
})();
</script>`;
