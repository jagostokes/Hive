// web: serve a generated HTML dashboard on localhost. Both lanes now emit a
// self-contained HTML fragment (markup + an inline <script> that draws charts
// with Chart.js). The host wraps that fragment in a fixed shell that loads
// Chart.js from a CDN, paints the dark theme, exposes the data as the global
// `DASHBOARD_DATA`, and installs a guaranteed-render fallback: if the model's
// fragment throws or renders nothing, a generic renderer draws the embedded data
// so both lanes always display their findings.
import http from "node:http";

export interface DashboardServer {
  url: string;
  port: number;
  html: string;
  close: () => Promise<void>;
}

/**
 * Normalize whatever the model returned into a body fragment we can drop into the
 * shell: strip code fences and any <!doctype>/<html>/<head>/<body> wrappers
 * (salvaging <style> blocks) and drop external <script src> tags (the shell
 * already provides Chart.js). A model that already returns a bare fragment passes
 * through essentially unchanged.
 */
export function sanitizeFragment(modelOutput: string): string {
  let s = (modelOutput ?? "").trim();

  const fence = s.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  // Salvage any <style> blocks (head or body) so styling survives unwrapping.
  const styles = (s.match(/<style[\s\S]*?<\/style>/gi) ?? []).join("\n");

  // Prefer the <body> inner content when a full document was returned.
  let inner: string;
  const body = s.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (body) {
    inner = body[1];
  } else {
    inner = s
      .replace(/<!doctype[^>]*>/gi, "")
      .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
      .replace(/<\/?html[^>]*>/gi, "");
  }

  inner = inner
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*\bsrc=[^>]*>\s*<\/script>/gi, "")
    .trim();

  return (styles ? `${styles}\n` : "") + inner;
}

export function buildDashboardHtml(modelOutput: string, data: unknown, title = "Hive Dashboard"): string {
  const fragment = sanitizeFragment(modelOutput);
  // Escape "<" so a stray "</script>" inside the data can't close our block.
  const dataJson = JSON.stringify(data ?? null).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script>
  tailwind.config = {
    theme: {
      extend: {
        colors: {
          'hive-bg': '#0f172a',
          'hive-card': '#1e293b',
          'hive-border': '#334155',
          'hive-text': '#e2e8f0',
          'hive-muted': '#94a3b8',
        }
      }
    }
  }
</script>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; }
  header { padding: 16px 24px; border-bottom: 1px solid #334155; font-weight: 600; backdrop-filter: blur(8px); }
  #hive-root { padding: 24px; }
  .hive-card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 20px; box-shadow: 0 4px 6px -1px rgba(0,0,0,.3), 0 2px 4px -2px rgba(0,0,0,.2); transition: all 0.2s; }
  .hive-card:hover { box-shadow: 0 10px 15px -3px rgba(0,0,0,.4); border-color: #475569; }
  .hive-card h3 { margin: 0 0 8px; font-size: 14px; color: #e2e8f0; font-weight: 600; }
  .hive-kpi { font-size: 2.25rem; font-weight: 700; color: #6366f1; }
  .hive-muted { color: #94a3b8; font-size: 13px; margin-top: 4px; }
  .hive-error { color: #f87171; white-space: pre-wrap; padding: 16px; }
  canvas { max-width: 100%; }
</style>
</head>
<body>
<header>${escapeHtml(title)}</header>
<script>window.DASHBOARD_DATA = ${dataJson};</script>
<div id="hive-root">
${fragment}
</div>
<script>
(function () {
  var PALETTE = ["#6366f1","#8b5cf6","#ec4899","#f59e0b","#10b981","#3b82f6"];
  function num(v) { var n = Number(v); return isFinite(n) ? n : null; }
  function fallback() {
    var data = window.DASHBOARD_DATA;
    var charts = data && Array.isArray(data.charts) ? data.charts
      : (Array.isArray(data) ? [{ question: "Result", rows: data }] : []);
    var root = document.getElementById("hive-root");
    if (!root) return;
    root.innerHTML = "";
    if (!charts.length) { root.innerHTML = '<div class="hive-error">No data to display.</div>'; return; }
    var grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px";
    root.appendChild(grid);
    charts.forEach(function (c) {
      var rows = Array.isArray(c.rows) ? c.rows : [];
      var card = document.createElement("div"); card.className = "hive-card";
      var h = document.createElement("h3");
      h.textContent = (c.plan && c.plan.title) || c.question || "Result";
      card.appendChild(h);
      if (!rows.length) {
        var e = document.createElement("div"); e.className = "hive-muted"; e.textContent = "No rows.";
        card.appendChild(e); grid.appendChild(card); return;
      }
      var keys = Object.keys(rows[0]);
      var numKey = (c.plan && c.plan.y) || keys.filter(function (k) { return rows.every(function (r) { return num(r[k]) != null; }); })[0];
      var labelKey = (c.plan && c.plan.x) || keys.filter(function (k) { return k !== numKey; })[0] || keys[0];
      if (rows.length === 1 && numKey) {
        var kpi = document.createElement("div"); kpi.className = "hive-kpi";
        kpi.textContent = Number(rows[0][numKey]).toLocaleString(); card.appendChild(kpi);
        var lbl = document.createElement("div"); lbl.className = "hive-muted"; lbl.textContent = numKey; card.appendChild(lbl);
      } else if (numKey && window.Chart) {
        var wrap = document.createElement("div"); wrap.style.cssText = "position:relative;height:260px";
        var cv = document.createElement("canvas"); wrap.appendChild(cv); card.appendChild(wrap);
        new Chart(cv.getContext("2d"), {
          type: "bar",
          data: {
            labels: rows.map(function (r) { return String(r[labelKey]); }),
            datasets: [{ label: numKey, data: rows.map(function (r) { return num(r[numKey]); }),
              backgroundColor: rows.map(function (_, i) { return PALETTE[i % PALETTE.length]; }) }]
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
            scales: { x: { ticks: { color: "#94a3b8" }, grid: { color: "#1e293b" } },
              y: { ticks: { color: "#94a3b8" }, grid: { color: "#1e293b" } } } }
        });
      } else {
        var pre = document.createElement("pre"); pre.className = "hive-muted";
        pre.textContent = JSON.stringify(rows.slice(0, 10), null, 2); card.appendChild(pre);
      }
      if (c.insight) { var cap = document.createElement("div"); cap.className = "hive-muted"; cap.textContent = c.insight; card.appendChild(cap); }
      grid.appendChild(card);
    });
  }
  window.__hiveFallback = fallback;
  // A runtime error in the model's inline script -> draw the data ourselves.
  window.addEventListener("error", function () { try { fallback(); } catch (e) {} });
  // The "rendered nothing" case (no error, just an empty root).
  setTimeout(function () {
    var r = document.getElementById("hive-root");
    if (!r) return;
    var hasVis = r.querySelectorAll("canvas,svg,table,.hive-card").length > 0;
    var hasText = r.textContent.replace(/\\s/g, "").length >= 2;
    if (!hasVis && !hasText) { fallback(); }
  }, 300);
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
