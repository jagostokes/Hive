// Workspace: the two-panel side-by-side. Left = the Hive (brain swarm). Right =
// the single LLM (baseline). The user types ONE question, both panels run their
// respective lanes in parallel against the shared run ledger.
//
// IMPORTANT: a paired run is keyed by a SINGLE runId. We start the run from
// either input box (both inputs submit the same question to the same run), and
// then both panels read live state off the SSE event stream.
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  fetchModels,
  htmlDownloadUrl,
  startRun,
  subscribeRun,
  type BrainAgent,
  type LaneState,
  type LedgerEntry,
  type ModelsResponse,
  type RunEvent,
  type Totals,
} from "../lib/api";
import { dropLevelFromProgress, labelForRole, usd } from "../lib/agents";
import { QuestionInput } from "../components/QuestionInput";
import { BeeSwarm } from "../components/BeeSwarm";
import { DropProgress } from "../components/DropProgress";
import { AnalyticsCard } from "../components/AnalyticsCard";
import { HexButton } from "../components/HexButton";
import { Bee } from "../components/sprites/bees";
import { HiveSprite } from "../components/sprites/Hive";

const HEADER =
  "Using many different scope system prompt and data access small LLMs with an orchestrator LLM for the specific type of prompt for data analytics questions.";

const EMPTY_LANE: LaneState = {
  status: "pending",
  startedAt: null,
  finishedAt: null,
  completedRoles: [],
  activeRole: null,
  html: null,
};

const EMPTY_TOTALS: Totals = {
  calls: 0,
  promptTokens: 0,
  completionTokens: 0,
  costUsd: 0,
  byLane: {
    brain: { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 },
    baseline: { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 },
  },
};

export function Workspace(): JSX.Element {
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [question, setQuestion] = useState<string>("");
  const [brain, setBrain] = useState<LaneState>(EMPTY_LANE);
  const [baseline, setBaseline] = useState<LaneState>(EMPTY_LANE);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [totals, setTotals] = useState<Totals>(EMPTY_TOTALS);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const closeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    fetchModels()
      .then(setModels)
      .catch((err) => setModelsError(err.message ?? "could not load models"));
  }, []);

  useEffect(
    () => () => {
      closeRef.current?.();
    },
    [],
  );

  const onEvent = (e: RunEvent): void => {
    setBrain(e.brain);
    setBaseline(e.baseline);
    setLedger(e.ledger);
    if (e.totals) setTotals(e.totals);
  };

  const submit = async (q: string): Promise<void> => {
    if (runId) return; // a run is already in flight on this workspace
    setSubmitError(null);
    setQuestion(q);
    try {
      const id = await startRun(q);
      setRunId(id);
      closeRef.current = subscribeRun(id, onEvent, (err) => {
        // EventSource auto-retries; just surface once.
        setSubmitError(err.message);
      });
    } catch (err) {
      setSubmitError((err as Error).message);
    }
  };

  const reset = (): void => {
    closeRef.current?.();
    closeRef.current = null;
    setRunId(null);
    setQuestion("");
    setBrain(EMPTY_LANE);
    setBaseline(EMPTY_LANE);
    setLedger([]);
    setTotals(EMPTY_TOTALS);
    setSubmitError(null);
  };

  const brainAgents: BrainAgent[] = models?.brain ?? [];
  const totalRoles = brainAgents.length || 6;

  const brainLevel = dropLevelFromProgress(
    brain.completedRoles.length,
    totalRoles,
    brain.status === "complete",
  );
  // The baseline is a single model — it goes straight to full when complete.
  const baselineLevel = useMemo<0 | 1 | 2 | 3 | 4>(() => {
    if (baseline.status === "complete") return 4;
    if (baseline.status === "running") return 1; // a hint that it's filling
    return 0;
  }, [baseline.status]);

  const running = brain.status === "running" || baseline.status === "running";

  return (
    <main
      style={{
        position: "relative",
        minHeight: "100vh",
        padding: "32px clamp(20px, 4vw, 64px) 64px",
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      {/* top header */}
      <header
        style={{
          textAlign: "center",
          maxWidth: 920,
          margin: "8px auto 8px",
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            columnGap: 14,
            marginBottom: 12,
          }}
        >
          <Bee variant={1} pixel={3} active />
          <span
            className="display"
            style={{
              fontSize: 22,
              fontStyle: "italic",
              fontWeight: 400,
              letterSpacing: "0.005em",
            }}
          >
            The Hive · Workspace
          </span>
          <Bee variant={3} pixel={3} active />
        </motion.div>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25, duration: 0.7 }}
          className="muted"
          style={{
            margin: 0,
            fontSize: 14,
            lineHeight: 1.55,
            maxWidth: 760,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          {HEADER}
        </motion.p>
      </header>

      {modelsError && (
        <div
          style={{
            border: "1px solid var(--line)",
            padding: 12,
            borderRadius: 4,
            color: "var(--bark-soft)",
            fontSize: 13,
          }}
        >
          could not load model config from API: {modelsError}
        </div>
      )}

      {/* two-panel grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1px 1fr",
          columnGap: 0,
          alignItems: "stretch",
          borderTop: "1px solid var(--line)",
          paddingTop: 28,
        }}
      >
        <Panel
          side="left"
          title="Hive Question"
          subtitle={`${brainAgents.length || 6} small models · orchestrated`}
          question={question}
          onSubmit={submit}
          inputDisabled={Boolean(runId)}
        >
          <BeeSwarm
            agents={brainAgents}
            activeRole={brain.activeRole}
            completedRoles={brain.completedRoles}
            ledger={ledger}
            running={brain.status === "running"}
          />
          <DropProgress
            level={brainLevel}
            ready={brain.status === "complete" && Boolean(brain.html)}
            downloadUrl={runId ? htmlDownloadUrl(runId, "brain") : null}
            filename={`hive-brain.html`}
            caption={
              brain.status === "complete"
                ? "Tap the drop to download your dashboard"
                : brain.status === "running"
                  ? `Working through ${brain.completedRoles.length}/${totalRoles} agents…`
                  : brain.status === "error"
                    ? `error: ${brain.reason ?? "unknown"}`
                    : "Submit a question to begin."
            }
          />
        </Panel>

        <div className="hex-divider" />

        <Panel
          side="right"
          title="Large Language Model Question"
          subtitle={models?.baseline.label ?? "single strong model · end to end"}
          question={question}
          onSubmit={submit}
          inputDisabled={Boolean(runId)}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "8px 0",
              rowGap: 12,
            }}
          >
            <HiveSprite pixel={6} active={baseline.status === "running"} />
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontSize: 14,
                color: "var(--bark)",
                textAlign: "center",
              }}
            >
              {models?.baseline.label ?? "—"}
            </div>
            <div
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 11,
                color: "var(--muted)",
                fontFeatureSettings: '"tnum" 1',
              }}
            >
              {usd(totals.byLane.baseline.costUsd)}
              {baseline.status === "running" ? " · running…" : ""}
            </div>
          </div>
          <DropProgress
            level={baselineLevel}
            ready={baseline.status === "complete" && Boolean(baseline.html)}
            downloadUrl={runId ? htmlDownloadUrl(runId, "baseline") : null}
            filename={`hive-baseline.html`}
            caption={
              baseline.status === "complete"
                ? "Tap the drop to download your dashboard"
                : baseline.status === "running"
                  ? "The single model is working…"
                  : baseline.status === "error"
                    ? `error: ${baseline.reason ?? "unknown"}`
                    : "Submit a question to begin."
            }
          />
        </Panel>
      </div>

      {/* analytics card */}
      <AnalyticsCard totals={totals} />

      {/* reset */}
      <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
        <HexButton onClick={reset} size="md" variant="outline" disabled={!runId && !question}>
          Reset
        </HexButton>
      </div>

      {submitError && (
        <div
          style={{
            textAlign: "center",
            fontSize: 13,
            color: "var(--bark-soft)",
            fontStyle: "italic",
          }}
        >
          {submitError}
        </div>
      )}

      {/* tiny ledger trail (debug-quiet, helpful) */}
      {running && ledger.length > 0 && (
        <details
          style={{
            margin: "8px auto 0",
            maxWidth: 720,
            fontSize: 12,
            color: "var(--muted)",
            fontFamily: "var(--font-body)",
          }}
        >
          <summary style={{ cursor: "pointer", fontStyle: "italic" }}>
            ledger · {ledger.length} call{ledger.length === 1 ? "" : "s"}
          </summary>
          <ul style={{ listStyle: "none", padding: 0, margin: "8px 0" }}>
            {ledger.slice(-8).map((e, i) => (
              <li
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "70px 1fr auto",
                  columnGap: 12,
                  padding: "2px 0",
                  borderBottom: "1px dotted var(--line)",
                }}
              >
                <span style={{ color: e.lane === "brain" ? "var(--honey-deep)" : "var(--bark-soft)" }}>
                  {e.lane}
                </span>
                <span>{labelForRole(e.role)}</span>
                <span style={{ fontFeatureSettings: '"tnum" 1' }}>{usd(e.costUsd)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}

// --- Panel scaffold ---

interface PanelProps {
  side: "left" | "right";
  title: string;
  subtitle: string;
  question: string;
  onSubmit: (q: string) => void;
  inputDisabled: boolean;
  children: React.ReactNode;
}

function Panel({ side, title, subtitle, question, onSubmit, inputDisabled, children }: PanelProps): JSX.Element {
  return (
    <section
      style={{
        padding: `8px ${side === "left" ? "32px 8px 0" : "0 8px 32px"}`,
        display: "flex",
        flexDirection: "column",
        rowGap: 18,
      }}
    >
      <header style={{ display: "grid", rowGap: 4 }}>
        <h2
          className="display"
          style={{
            margin: 0,
            fontSize: 30,
            fontWeight: 400,
            letterSpacing: "-0.012em",
          }}
        >
          {title}
        </h2>
        <div
          className="muted"
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: 13,
          }}
        >
          {subtitle}
        </div>
      </header>
      {question ? (
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: 19,
            color: "var(--bark)",
            paddingBottom: 12,
            borderBottom: "1px solid var(--line)",
            lineHeight: 1.35,
            minHeight: 56,
          }}
        >
          “{question}”
        </div>
      ) : (
        <QuestionInput onSubmit={onSubmit} disabled={inputDisabled} />
      )}
      {children}
    </section>
  );
}
