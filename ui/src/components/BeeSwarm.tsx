// The row of 6 bees on the left panel — one per brain agent role. Each bee
// shows its live model slug + accumulating USD. Active bees flutter; completed
// bees go still and crisp; pending bees are dimmed.
import type { BrainAgent, LedgerEntry } from "../lib/api";
import { SpriteBee } from "./sprites/SpriteBee";
import { labelForRole, spriteForRole, usd } from "../lib/agents";

interface BeeSwarmProps {
  agents: BrainAgent[];
  activeRole: string | null;
  completedRoles: string[];
  cachedRoles: string[];
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
  completedRoles = [],
  cachedRoles = [],
  ledger,
  running,
}: BeeSwarmProps): JSX.Element {
  if (agents.length === 0) {
    return (
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          fontSize: 12,
          color: "var(--muted)",
          textAlign: "center",
          padding: "16px 0",
        }}
      >
        loading agent roster…
      </div>
    );
  }
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${agents.length}, 1fr)`,
        gap: 4,
        padding: "4px 0",
      }}
    >
      {agents.map((agent, i) => {
        const cached = cachedRoles.includes(agent.role);
        const done = completedRoles.includes(agent.role) || cached;
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
              rowGap: 3,
              minWidth: 0,
            }}
          >
            <div
              style={{
                width: 72,
                height: 56,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
              }}
            >
              <SpriteBee
                role={spriteForRole(agent.role, i)}
                size={48}
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
                fontSize: 12.5,
                color: idle ? "var(--muted)" : "var(--bark)",
                textAlign: "center",
                lineHeight: 1.15,
                minHeight: 15,
              }}
            >
              {labelForRole(agent.role)}
            </div>
            <div
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 11,
                color: "var(--muted)",
                textAlign: "center",
                lineHeight: 1.3,
                wordBreak: "break-word",
                maxWidth: 120,
                minHeight: 44,
                fontFeatureSettings: '"tnum" 1',
              }}
              title={agent.slug}
            >
              {agent.label}
              {agent.params && (
                <>
                  <br />
                  <span
                    style={{
                      fontWeight: 700,
                      color: "var(--bark)",
                      letterSpacing: "0.04em",
                      fontFeatureSettings: '"tnum" 1',
                    }}
                  >
                    {agent.params.toUpperCase()} PARAMS
                  </span>
                </>
              )}
              <br />
              {cached ? (
                <span
                  style={{
                    color: "var(--honey-deep)",
                    fontStyle: "italic",
                    fontFamily: "var(--font-display)",
                    fontWeight: 500,
                  }}
                >
                  stepped cached
                </span>
              ) : (
                <span
                  style={{
                    color: cost > 0 ? "var(--bark-soft)" : "var(--muted)",
                    fontWeight: 500,
                  }}
                >
                  {usd(cost)}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
