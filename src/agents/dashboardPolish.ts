// agents/dashboardPolish: a cheap second pass that polishes a working dashboard's
// visual design without touching data bindings or chart logic. Runs on V4 Flash
// (the insight model) — the HTML is small (~2KB) so this costs almost nothing.
// Only invoked when codeGen succeeds (the HTML renders) but before serving.
import { callModel } from "../models/index.js";
import { renderVerifier } from "../verifiers/index.js";
import { stripCodeFence } from "./parse.js";

const POLISH_SYSTEM =
  "You are a dashboard design polisher. You receive a working HTML dashboard fragment " +
  "(markup + inline script using Chart.js and Tailwind CSS). " +
  "Improve ONLY the visual design. Do NOT change:\n" +
  "- Data bindings (window.DASHBOARD_DATA references)\n" +
  "- Chart.js configurations (type, datasets, labels)\n" +
  "- The number or order of cards\n" +
  "- Any JavaScript logic\n\n" +
  "DO improve:\n" +
  "- Add subtle gradient backgrounds to cards (e.g. bg-gradient-to-br from-[#1e293b] to-[#0f172a])\n" +
  "- Add hover:scale-[1.01] transitions on cards\n" +
  "- Improve typography hierarchy (larger titles, better spacing)\n" +
  "- Add subtle decorative elements (thin colored top-border on cards matching the chart color)\n" +
  "- Add a dashboard summary row or header section if missing\n" +
  "- Ensure consistent spacing and alignment\n" +
  "- Use Tailwind utility classes (the host loads Tailwind CDN)\n\n" +
  "Return ONLY the improved HTML fragment. No prose, no code fences, no <html>/<head>/<body>.";

export interface PolishResult {
  /** Whether the polish pass produced valid HTML. */
  ok: boolean;
  /** The polished HTML (or the original if polish failed). */
  code: string;
  /** Whether the polish pass was actually applied (false = fell back to original). */
  polished: boolean;
}

/**
 * Run a cheap polish pass on a working dashboard HTML fragment.
 * If the polished version fails render verification, silently falls back to the original.
 */
export async function polishDashboard(originalHtml: string): Promise<PolishResult> {
  try {
    const res = await callModel({
      role: "insight", // V4 Flash — cheapest model
      lane: "brain",
      temperature: 0.3, // slight creativity for design
      maxTokens: 4000,
      messages: [
        { role: "system", content: POLISH_SYSTEM },
        {
          role: "user",
          content: [
            "Here is the working dashboard HTML fragment to polish:",
            "",
            originalHtml,
            "",
            "Return the improved HTML fragment only.",
          ].join("\n"),
        },
      ],
    });

    const polished = stripCodeFence(res.text);

    // Verify the polished version still renders correctly.
    const check = renderVerifier(polished);
    if (check.ok) {
      return { ok: true, code: polished, polished: true };
    }

    // Polish broke the HTML — fall back to original.
    return { ok: true, code: originalHtml, polished: false };
  } catch {
    // Model call failed — fall back to original.
    return { ok: true, code: originalHtml, polished: false };
  }
}
