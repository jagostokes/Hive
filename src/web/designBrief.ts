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
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
];

export const DASHBOARD_DESIGN_BRIEF = `DESIGN BRIEF — produce ONE polished, self-contained HTML dashboard fragment:
- Output an HTML FRAGMENT only: your markup plus ONE inline <script>. Do NOT include <!doctype>, <html>, <head>, <body>, or any <script src="..."> tags — the host page already loads Chart.js (global \`Chart\`), Tailwind CSS, and paints the dark page background.
- USE TAILWIND CSS — the host page loads the Tailwind CDN. Use Tailwind utility classes for ALL styling (layout, spacing, colors, typography, rounded corners, shadows). Avoid inline style="..." unless Chart.js requires it (e.g. canvas wrapper height).
- Charts: use Chart.js via the global \`Chart\` with these DEFAULTS on every chart: { responsive: true, maintainAspectRatio: false, borderRadius: 6, tension: 0.3 }. Create <canvas> elements. Pick the type by the data: a LINE for a trend over a date/time column, a DOUGHNUT for a share/part-of-whole breakdown, a BAR for comparing categories, and a KPI tile for a single scalar. Do NOT load any other chart library.
- Axis formatting: when the x values are dates/timestamps, format them to short readable labels (e.g. new Date(v).toLocaleDateString()) — never show raw ISO strings. When the metric is a whole-number count, use integer ticks (scales.y.ticks.precision = 0) so the axis isn't 0.1, 0.2, ….
- Layout: use Tailwind grid classes — \`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4\`. Each card: \`bg-[#1e293b] border border-[#334155] rounded-xl p-5 shadow-lg shadow-black/20 transition-all duration-200 hover:shadow-xl hover:border-[#475569]\`. Give each card a title (\`text-[#e2e8f0] font-semibold text-sm\`) and, when an insight is provided, a small muted caption (\`text-[#94a3b8] text-xs mt-2\`).
- Theme: page bg #0f172a (host provides this). Card bg #1e293b, borders #334155, text #e2e8f0, muted #94a3b8. Chart axes/gridlines should use #94a3b8 / #1e293b. Series colors cycle through ["#6366f1","#8b5cf6","#ec4899","#f59e0b","#10b981","#3b82f6"].
- Sizing (CRITICAL — get this exactly right): NEVER place a bare <canvas> in the card. ALWAYS wrap it: <div class="relative" style="height:260px"><canvas></canvas></div>, and ALWAYS pass Chart.js options { responsive:true, maintainAspectRatio:false }. Without BOTH the chart stretches to fill the page and renders unreadable. For value axes set scales.y.beginAtZero:true.
- KPI fallback: if a result is a single row OR a single numeric value, render a big KPI tile — number: \`text-4xl font-bold\` in the series color, unit label: \`text-sm text-[#94a3b8] mt-1\`. Never render "No data" when rows exist.
- Polish: add subtle hover transitions on cards (already in the card classes above). Use \`backdrop-blur-sm\` on the dashboard header if present. Doughnut charts should have a subtle center cutout label (total or percentage).
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
export const DASHBOARD_EXAMPLE = `<div id="hive-grid" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"></div>
<script>
(function () {
  const PALETTE = ["#6366f1","#8b5cf6","#ec4899","#f59e0b","#10b981","#3b82f6"];
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const grid = document.getElementById("hive-grid");
  const charts = (window.DASHBOARD_DATA && window.DASHBOARD_DATA.charts) || [];

  charts.forEach((c, idx) => {
    const rows = Array.isArray(c.rows) ? c.rows : [];
    const card = document.createElement("div");
    card.className = "bg-[#1e293b] border border-[#334155] rounded-xl p-5 shadow-lg shadow-black/20 transition-all duration-200 hover:shadow-xl hover:border-[#475569]";
    const title = document.createElement("h3");
    title.className = "text-[#e2e8f0] font-semibold text-sm mb-2";
    title.textContent = (c.plan && c.plan.title) || c.question || "Result";
    card.appendChild(title);

    const keys = rows.length ? Object.keys(rows[0]) : [];
    const yKey = (c.plan && c.plan.y) || keys.find((k) => rows.every((r) => num(r[k]) !== null));
    const xKey = (c.plan && c.plan.x) || keys.find((k) => k !== yKey) || keys[0];

    const planType = (c.plan && c.plan.type) || "";
    const isKpi = /kpi|stat|single|value|number/i.test(planType) || (rows.length === 1 && yKey);
    if (isKpi && yKey) {
      const kpi = document.createElement("div");
      kpi.className = "text-4xl font-bold mt-2";
      kpi.style.color = PALETTE[idx % PALETTE.length];
      kpi.textContent = Number(rows[0][yKey]).toLocaleString();
      const lbl = document.createElement("div");
      lbl.className = "text-[#94a3b8] text-sm mt-1";
      lbl.textContent = yKey;
      card.appendChild(kpi); card.appendChild(lbl);
    } else if (yKey) {
      const wrap = document.createElement("div");
      wrap.className = "relative";
      wrap.style.height = "260px";
      const canvas = document.createElement("canvas");
      wrap.appendChild(canvas); card.appendChild(wrap);
      const type = /pie|doughnut|donut/i.test(planType) ? "doughnut"
        : /line|trend|time|date/i.test(planType) ? "line" : "bar";
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
          borderRadius: 6, tension: 0.3, fill: false, pointRadius: type === "line" ? 3 : 0
        }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: type === "doughnut", labels: { color: "#e2e8f0" } } },
          scales: type === "doughnut" ? {} : {
            x: { ticks: { color: "#94a3b8", maxRotation: 0, autoSkip: true }, grid: { color: "#1e293b" } },
            y: { beginAtZero: true, ticks: Object.assign({ color: "#94a3b8" }, allInt ? { precision: 0 } : {}), grid: { color: "#1e293b" } }
          }
        }
      });
    }

    if (c.insight) {
      const cap = document.createElement("div");
      cap.className = "text-[#94a3b8] text-xs mt-2";
      cap.textContent = c.insight;
      card.appendChild(cap);
    }
    grid.appendChild(card);
  });
})();
</script>`;
