// The row of 6 bees on the left panel — one per brain agent role. Each bee
// shows its live model slug + accumulating USD. Active bees flutter; completed
// bees go still and crisp; pending bees are dimmed.
import type { BrainAgent, LedgerEntry } from "../lib/api";
import { Bee } from "./sprites/bees";
import { labelForRole, usd, variantForRole } from "../lib/agents";

interface BeeSwarmProps {
  agents: BrainAgent[];
  activeRole: string | null;
  completedRoles: string[];
  ledger: LedgerEntry[];
  running: boolean;
}

function costForRole(ledger: LedgerEntry[], role: string): number {
  return ledger
    .filter((e) => e.lane === "brain" && e.role === role)
    .reduce((acc, e) => acc + e.costUsd, 0);
}

export function BeeSwarm({
  agents,
  activeRole,
  completedRoles,
  ledger,
  running,
}: BeeSwarmProps): JSX.Element {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${agents.length}, 1fr)`,
        gap: 6,
        padding: "8px 0",
      }}
    >
      {agents.map((agent, i) => {
        const done = completedRoles.includes(agent.role);
        const active = running && activeRole === agent.role;
        const idle = !active && !done;
        const cost = costForRole(ledger, agent.role);
        return (
          <div
            key={agent.role}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              rowGap: 6,
              minWidth: 0,
            }}
          >
            <div
              style={{
                width: 88,
                height: 64,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
              }}
            >
              <Bee
                variant={variantForRole(agent.role, ((i % 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6)}
                pixel={4}
                active={active}
                done={done && !active}
                title={labelForRole(agent.role)}
              />
              {active && (
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    bottom: -2,
                    width: 22,
                    height: 3,
                    background: "var(--honey)",
                    borderRadius: 2,
                    animation: "hive-pulse 1.4s ease-in-out infinite",
                  }}
                />
              )}
            </div>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontSize: 12,
                color: idle ? "var(--muted)" : "var(--bark)",
                textAlign: "center",
                lineHeight: 1.15,
                minHeight: 14,
              }}
            >
              {labelForRole(agent.role)}
            </div>
            <div
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 10.5,
                color: "var(--muted)",
                textAlign: "center",
                lineHeight: 1.2,
                wordBreak: "break-word",
                maxWidth: 110,
                minHeight: 24,
                fontFeatureSettings: '"tnum" 1',
              }}
              title={agent.slug}
            >
              {agent.label}
              <br />
              <span
                style={{
                  color: cost > 0 ? "var(--bark-soft)" : "var(--muted)",
                  fontWeight: 500,
                }}
              >
                {usd(cost)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
