// web: serves the localhost dashboard showing the answer plus (later) the
// brain-pattern vs. baseline token/cost comparison. No build step — components
// render in-browser via Babel standalone + CDN React/Recharts.
export {
  buildDashboardHtml,
  serveDashboard,
  prepareComponent,
  type DashboardServer,
} from "./dashboardHost.js";
export {
  serveComparison,
  buildStatePayload,
  type ComparisonServer,
  type ComparisonOptions,
} from "./comparisonHost.js";
