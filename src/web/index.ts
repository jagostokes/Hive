// web: serves the localhost dashboard showing the answer plus the brain-pattern
// vs. baseline token/cost comparison. No build step — both lanes emit a
// self-contained HTML fragment rendered in a Chart.js shell with a data fallback.
export {
  buildDashboardHtml,
  serveDashboard,
  sanitizeFragment,
  type DashboardServer,
} from "./dashboardHost.js";
export {
  serveComparison,
  buildStatePayload,
  type ComparisonServer,
  type ComparisonOptions,
} from "./comparisonHost.js";
