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

(function mount() {
  const el = document.getElementById('root');
  try {
    const root = ReactDOM.createRoot(el);
    root.render(React.createElement(${mountName}, { data: window.__DATA__ }));
  } catch (err) {
    el.innerHTML = '<div class="hive-error">Render error:\\n' + (err && err.stack ? err.stack : String(err)) + '</div>';
  }
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
