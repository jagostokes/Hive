// web: serve a generated React dashboard component on localhost with no build
// step. The component is transpiled in the browser (Babel standalone) against
// React/ReactDOM/Recharts UMD globals from a CDN, so any self-contained component
// the codeGen agent produces can render without bundling.
import http from "node:http";

export interface DashboardServer {
  url: string;
  port: number;
  html: string;
  close: () => Promise<void>;
}

// Turn the generated module into something a <script type="text/babel"> block can
// evaluate: drop imports (deps come from CDN globals) and the `export` keywords,
// and figure out which component to mount.
export function prepareComponent(code: string): { body: string; mountName: string } {
  let body = code;
  body = body.replace(/^\s*import[^\n]*\n/gm, "");

  let mountName = "";
  const defFn = body.match(/export\s+default\s+function\s+([A-Za-z0-9_]+)/);
  const defNamed = body.match(/export\s+default\s+([A-Za-z0-9_]+)\s*;?/);
  if (defFn) mountName = defFn[1];
  else if (defNamed && !/function|class/.test(defNamed[1])) mountName = defNamed[1];

  // Name an anonymous default export so we can reference it.
  body = body.replace(/export\s+default\s+function\s*\(/, "function __DefaultExport__(");
  if (!mountName && /function __DefaultExport__\(/.test(body)) mountName = "__DefaultExport__";

  body = body.replace(/export\s+default\s+/g, "");
  body = body.replace(/export\s+(const|function|class|let|var)\s+/g, "$1 ");

  // Fallback: pick the first capitalized component-looking declaration.
  if (!mountName) {
    const fn = body.match(/function\s+([A-Z][A-Za-z0-9_]*)\s*\(/);
    const cst = body.match(/const\s+([A-Z][A-Za-z0-9_]*)\s*=/);
    mountName = fn?.[1] ?? cst?.[1] ?? "App";
  }
  return { body, mountName };
}

export function buildDashboardHtml(componentCode: string, data: unknown, title = "Hive Dashboard"): string {
  const { body, mountName } = prepareComponent(componentCode);
  const dataJson = JSON.stringify(data ?? null);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
<script crossorigin src="https://unpkg.com/recharts/umd/Recharts.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #0b0e14; color: #e6e6e6; }
  header { padding: 16px 24px; border-bottom: 1px solid #232a36; font-weight: 600; }
  #root { padding: 24px; }
  .hive-error { color: #ff6b6b; white-space: pre-wrap; padding: 16px; }
</style>
</head>
<body>
<header>${escapeHtml(title)}</header>
<div id="root"></div>
<script>window.__DATA__ = ${dataJson};</script>
<script type="text/babel" data-presets="react,typescript">
const { useState, useEffect, useMemo, useRef, useCallback, Fragment } = React;
const R = window.Recharts || {};
const {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, ScatterChart, Scatter, RadarChart, Radar,
  XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, ComposedChart
} = R;

${body}

// --- Guaranteed-render safety net -------------------------------------------
// React 18 throws render-time errors asynchronously, so a try/catch around
// root.render() will NOT catch a broken generated component — it just leaves
// the root empty. We wrap the model component in an error boundary and, if it
// errors OR renders nothing, fall back to a generic renderer driven by the
// embedded data (window.__DATA__). This makes both lanes display every time.
const HIVE_PALETTE = ["#4ade80","#60a5fa","#f59e0b","#f472b6","#22d3ee","#a78bfa"];
const hiveNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const hiveFmt = (v) => { const n = hiveNum(v); return n == null ? String(v) : n.toLocaleString(); };

function HiveCard({ chart }) {
  const rows = Array.isArray(chart && chart.rows) ? chart.rows : [];
  const plan = (chart && chart.plan) || {};
  const title = plan.title || (chart && chart.question) || "Result";
  const cardStyle = { background:"#11151f", border:"1px solid #232a36", borderRadius:12, padding:"16px 18px", boxShadow:"0 1px 2px rgba(0,0,0,.4)" };
  const titleStyle = { color:"#e6e6e6", fontSize:15, fontWeight:600, margin:"0 0 8px" };
  const captionStyle = { color:"#8b95a5", fontSize:12, marginTop:8 };
  if (!rows.length) {
    return React.createElement("div",{style:cardStyle},
      React.createElement("h3",{style:titleStyle}, title),
      React.createElement("div",{style:{color:"#8b95a5"}}, "No rows."));
  }
  const keys = Object.keys(rows[0]);
  const numericKey = plan.y || keys.find((k)=> rows.every((r)=> hiveNum(r[k]) != null));
  const labelKey = plan.x || keys.find((k)=> k !== numericKey) || keys[0];
  const caption = chart && chart.insight ? React.createElement("div",{style:captionStyle}, chart.insight) : null;
  // Single value or single row -> KPI tile.
  if (rows.length === 1 && numericKey) {
    return React.createElement("div",{style:cardStyle},
      React.createElement("h3",{style:titleStyle}, title),
      React.createElement("div",{style:{fontSize:34,fontWeight:700,color:HIVE_PALETTE[0]}}, hiveFmt(rows[0][numericKey])),
      React.createElement("div",{style:{color:"#8b95a5",fontSize:13,marginTop:4}}, numericKey),
      caption);
  }
  const chartData = rows.map((r)=> ({ ...r, [numericKey]: hiveNum(r[numericKey]) }));
  return React.createElement("div",{style:cardStyle},
    React.createElement("h3",{style:titleStyle}, title),
    React.createElement(ResponsiveContainer,{width:"100%",height:260},
      React.createElement(BarChart,{data:chartData},
        React.createElement(CartesianGrid,{stroke:"#232a36"}),
        React.createElement(XAxis,{dataKey:labelKey, tick:{fill:"#8b95a5",fontSize:12}}),
        React.createElement(YAxis,{tick:{fill:"#8b95a5",fontSize:12}, tickFormatter:hiveFmt}),
        React.createElement(Tooltip,{contentStyle:{background:"#11151f",border:"1px solid #232a36",color:"#e6e6e6"}}),
        React.createElement(Bar,{dataKey:numericKey, radius:[6,6,0,0]},
          chartData.map((d,i)=> React.createElement(Cell,{key:i, fill:HIVE_PALETTE[i % HIVE_PALETTE.length]}))))),
    caption);
}

function HiveFallback({ data }) {
  const charts = data && Array.isArray(data.charts) ? data.charts
    : Array.isArray(data) ? [{ question:"Result", rows:data }] : [];
  if (!charts.length) {
    return React.createElement("div",{style:{color:"#8b95a5",padding:16}}, "No data to display.");
  }
  return React.createElement("div",
    { style:{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(320px, 1fr))", gap:16 } },
    charts.map((c,i)=> React.createElement(HiveCard,{ key:i, chart:c })));
}

class HiveBoundary extends React.Component {
  constructor(p){ super(p); this.state = { failed:false }; }
  static getDerivedStateFromError(){ return { failed:true }; }
  componentDidCatch(){ /* swallow — fallback covers it */ }
  render(){
    return this.state.failed
      ? React.createElement(HiveFallback, { data: window.__DATA__ })
      : this.props.children;
  }
}

(function mount() {
  const el = document.getElementById('root');
  const ModelComp = (typeof ${mountName} !== 'undefined') ? ${mountName} : null;
  let root;
  try { root = ReactDOM.createRoot(el); }
  catch (err) { el.innerHTML = '<div class="hive-error">' + String(err) + '</div>'; return; }

  if (!ModelComp) {
    root.render(React.createElement(HiveFallback, { data: window.__DATA__ }));
    return;
  }
  root.render(React.createElement(HiveBoundary, null, React.createElement(ModelComp, { data: window.__DATA__ })));
  // Catch the "renders nothing" case (no error thrown, just an empty root).
  setTimeout(function(){
    if (!el.textContent || el.textContent.replace(/\\s/g,'').length < 2) {
      root.render(React.createElement(HiveFallback, { data: window.__DATA__ }));
    }
  }, 150);
})();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

/**
 * Serve a single HTML page on localhost. Port 0 picks a free port. Returns the
 * URL and a close() handle. Any path serves the dashboard.
 */
export async function serveDashboard(
  html: string,
  opts: { port?: number } = {},
): Promise<DashboardServer> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, resolve);
  });

  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : (opts.port ?? 0);
  return {
    url: `http://localhost:${port}`,
    port,
    html,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
