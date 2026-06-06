// Bottom analytics card. Shows brain vs baseline totals and the headline
// efficiency gain (1 − hive_cost / baseline_cost). Real numbers from
// totals.byLane, never mocked.
import type { Totals } from "../lib/api";
import { compactNum, usd } from "../lib/agents";

interface AnalyticsCardProps {
  totals: Totals | null;
}

function metric(
  label: string,
  value: string,
  emphasis?: "honey" | "bark",
): JSX.Element {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          fontSize: 13,
          color: "var(--muted)",
          letterSpacing: "0.02em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 26,
          fontWeight: 500,
          fontVariationSettings: '"opsz" 144',
          color: emphasis === "honey" ? "var(--honey-deep)" : "var(--bark)",
          letterSpacing: "-0.01em",
          fontFeatureSettings: '"tnum" 1',
          marginTop: 2,
        }}
      >
        {value}
      </div>
    </div>
  );
}

export function AnalyticsCard({ totals }: AnalyticsCardProps): JSX.Element {
  const brain = totals?.byLane.brain ?? { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 };
  const baseline = totals?.byLane.baseline ?? { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 };
  const efficiency =
    baseline.costUsd > 0 ? Math.max(0, 1 - brain.costUsd / baseline.costUsd) : 0;
  const efficiencyPct = `${(efficiency * 100).toFixed(1)}%`;

  return (
    <section
      style={{
        marginTop: 32,
        border: "1px solid var(--line)",
        background: "rgba(255,253,247,0.55)",
        backdropFilter: "saturate(1.05)",
        borderRadius: 6,
        padding: "28px 36px",
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1.1fr",
        columnGap: 32,
      }}
    >
      <div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: 14,
            color: "var(--bark-soft)",
            marginBottom: 16,
            letterSpacing: "0.02em",
          }}
        >
          The Hive (brain)
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            rowGap: 14,
            columnGap: 16,
          }}
        >
          {metric("in tokens", compactNum(brain.promptTokens))}
          {metric("out tokens", compactNum(brain.completionTokens))}
          {metric("calls", String(brain.calls))}
          {metric("cost", usd(brain.costUsd))}
        </div>
      </div>

      <div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: 14,
            color: "var(--bark-soft)",
            marginBottom: 16,
            letterSpacing: "0.02em",
          }}
        >
          Single LLM (baseline)
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            rowGap: 14,
            columnGap: 16,
          }}
        >
          {metric("in tokens", compactNum(baseline.promptTokens))}
          {metric("out tokens", compactNum(baseline.completionTokens))}
          {metric("calls", String(baseline.calls))}
          {metric("cost", usd(baseline.costUsd))}
        </div>
      </div>

      <div
        style={{
          borderLeft: "1px solid var(--line)",
          paddingLeft: 28,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: 14,
            color: "var(--bark-soft)",
            letterSpacing: "0.02em",
          }}
        >
          Token-efficiency gained by The Hive
        </div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 72,
            lineHeight: 1.02,
            fontWeight: 400,
            fontVariationSettings: '"opsz" 144',
            color: "var(--honey-deep)",
            letterSpacing: "-0.025em",
            marginTop: 6,
            fontFeatureSettings: '"tnum" 1',
          }}
        >
          {efficiencyPct}
        </div>
        <div
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 13,
            color: "var(--muted)",
            marginTop: 4,
          }}
        >
          {baseline.costUsd > 0
            ? `${usd(Math.max(0, baseline.costUsd - brain.costUsd))} saved vs. the single-model lane`
            : "awaiting baseline result…"}
        </div>
      </div>
    </section>
  );
}
