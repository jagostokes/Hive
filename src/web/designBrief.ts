// web/designBrief: the shared "model HTML concept" both lanes follow so the
// generated dashboards look like one designed product, not two ad-hoc pages.
// codeGen (brain) and the baseline strong model both receive DASHBOARD_DESIGN_BRIEF;
// codeGen additionally receives DASHBOARD_DATA_CONTRACT (it is handed real rows,
// whereas the baseline embeds its own tool results).

// Accent palette reused across cards/series. Kept here so both lanes match.
export const DASHBOARD_PALETTE = [
  "#4ade80",
  "#60a5fa",
  "#f59e0b",
  "#f472b6",
  "#22d3ee",
  "#a78bfa",
];

export const DASHBOARD_DESIGN_BRIEF = `DESIGN BRIEF — produce a polished, self-contained dashboard:
- ONE React function component, default-exported. Use only React + the "recharts" globals (ResponsiveContainer, BarChart/Bar, LineChart/Line, AreaChart/Area, PieChart/Pie/Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend). No imports, no external CSS — inline styles only.
- Dark theme. Page is transparent (host paints the background). Cards: background #11151f, 1px solid #232a36 border, border-radius 12px, padding 16px 18px, box-shadow 0 1px 2px rgba(0,0,0,.4). Text #e6e6e6, muted labels #8b95a5.
- Accent palette (cycle through it for series/slices): ["#4ade80","#60a5fa","#f59e0b","#f472b6","#22d3ee","#a78bfa"].
- Layout: a responsive CSS grid of cards — display:grid, gridTemplateColumns:"repeat(auto-fit, minmax(320px, 1fr))", gap:16px. Give each card a short title and, when an insight string is provided, a small muted caption under the chart.
- Charts: wrap every chart in <ResponsiveContainer width="100%" height={260}>. Use a subtle CartesianGrid (stroke #232a36), axis ticks in #8b95a5, and a Tooltip. Coerce numeric-looking strings to Number for axis/series values. Format large numbers with toLocaleString.
- KPI fallback: if a chart's rows are a single row OR a single numeric value, render a big KPI tile (large bold number ~34px + a muted label) instead of an empty chart. Never render "No data available" when rows exist.
- Be defensive: guard against missing/empty arrays so the component always renders something meaningful.`;

export const DASHBOARD_DATA_CONTRACT = `DATA CONTRACT — at runtime your component receives a single prop \`data\` whose value is EXACTLY the JSON shown below under "DASHBOARD". Its shape is:
{
  "title": string,
  "charts": [
    {
      "id": string,
      "question": string,            // the sub-question this card answers
      "plan": { "type": string, "x"?: string, "y"?: string, "title"?: string },
      "rows": [ { "<column>": value, ... } ],   // the actual query result rows
      "insight"?: string             // optional one-line takeaway to show as a caption
    }
  ]
}
Render one card per entry in \`data.charts\`, using plan.type/x/y to pick the chart and map \`rows\`. Treat \`data\` defensively (it may be null) and ALSO embed the same JSON as a default value so the component renders even when mounted without props.`;
