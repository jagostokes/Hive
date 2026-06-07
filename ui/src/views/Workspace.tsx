// Workspace: the two-panel side-by-side. ONE universal question input sits
// above both panels; submitting kicks off both lanes against a single runId.
// Layout is sized to fit a typical desktop viewport without scrolling.
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
import { SpriteBee } from "../components/sprites/SpriteBee";

const HEADER =
  "Using many different scope system prompt and data access small LLMs with an orchestrator LLM for the specific type of prompt for data analytics questions.";

const EMPTY_LANE: LaneState = {
  status: "pending",
  startedAt: null,
  finishedAt: null,
  completedRoles: [],
  cachedRoles: [],
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

  // Defensively coerce server payload — an older API server (started before the
  // latest changes) may omit `cachedRoles` or `completedRoles`. Missing fields
  // would crash the UI when we call .includes on them, so normalize on receipt.
  const normalizeLane = (lane: LaneState | undefined): LaneState => ({
    ...EMPTY_LANE,
    ...(lane ?? {}),
    completedRoles: lane?.completedRoles ?? [],
    cachedRoles: lane?.cachedRoles ?? [],
  });

  const onEvent = (e: RunEvent): void => {
    setBrain(normalizeLane(e.brain));
    setBaseline(normalizeLane(e.baseline));
    setLedger(e.ledger ?? []);
    if (e.totals) setTotals(e.totals);
  };

  const submit = async (q: string): Promise<void> => {
    if (runId) return;
    setSubmitError(null);
    setQuestion(q);
    try {
      const id = await startRun(q);
      setRunId(id);
      closeRef.current = subscribeRun(id, onEvent, (err) => {
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
  const baselineLevel = useMemo<0 | 1 | 2 | 3 | 4>(() => {
    if (baseline.status === "complete") return 4;
    if (baseline.status === "running") return 1;
    return 0;
  }, [baseline.status]);

  const running = brain.status === "running" || baseline.status === "running";

  return (
    <main
      style={{
        position: "relative",
        height: "100vh",
        padding: "18px clamp(20px, 3.4vw, 48px) 22px",
        display: "grid",
        gridTemplateRows: "auto auto 1fr auto auto",
        rowGap: 12,
        overflow: "hidden",
      }}
    >
      {/* top header — tight */}
      <header style={{ textAlign: "center", maxWidth: 900, margin: "0 auto" }}>
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            columnGap: 12,
            marginBottom: 4,
          }}
        >
          <SpriteBee role="orchestrator" size={24} active />
          <span
            className="display"
            style={{
              fontSize: 18,
              fontStyle: "italic",
              fontWeight: 400,
              letterSpacing: "0.005em",
            }}
          >
            The Hive · Workspace
          </span>
          <SpriteBee role="planner" size={24} active />
        </motion.div>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="muted"
          style={{
            margin: 0,
            fontSize: 12.5,
            lineHeight: 1.45,
            maxWidth: 720,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          {HEADER}
        </motion.p>
      </header>

      {/* universal Ask bar */}
      <div
        style={{
          maxWidth: 880,
          margin: "0 auto",
          width: "100%",
          borderTop: "1px solid var(--line)",
          borderBottom: "1px solid var(--line)",
          padding: "8px 12px",
        }}
      >
        {question ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              columnGap: 14,
              minHeight: 44,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontSize: 17,
                color: "var(--bark)",
                lineHeight: 1.3,
                flex: 1,
              }}
            >
              “{question}”
            </div>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontSize: 12,
                color: "var(--muted)",
                whiteSpace: "nowrap",
              }}
            >
              {running ? "running both lanes…" : brain.status === "complete" ? "complete" : ""}
            </div>
          </div>
        ) : (
          <QuestionInput onSubmit={submit} disabled={Boolean(runId)} />
        )}
      </div>

      {modelsError && (
        <div
          style={{
            border: "1px solid var(--line)",
            padding: 8,
            borderRadius: 4,
            color: "var(--bark-soft)",
            fontSize: 12,
            textAlign: "center",
          }}
        >
          could not load model config: {modelsError}
        </div>
      )}

      {/* two-panel grid — flex fills available vertical space */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 2px 1fr",
          columnGap: 0,
          alignItems: "stretch",
          minHeight: 0,
        }}
      >
        <Panel
          side="left"
          title="Hive Question"
          subtitle={`${brainAgents.length || 6} small models · orchestrated`}
        >
          <div
            style={{
              minHeight: 140,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <BeeSwarm
              agents={brainAgents}
              activeRole={brain.activeRole}
              completedRoles={brain.completedRoles}
              cachedRoles={brain.cachedRoles}
              ledger={ledger}
              running={brain.status === "running"}
            />
          </div>
          <DropProgress
            level={brainLevel}
            ready={brain.status === "complete" && Boolean(brain.html)}
            downloadUrl={runId ? htmlDownloadUrl(runId, "brain") : null}
            filename="BRAIN-METHOD.html"
            caption={
              brain.status === "complete"
                ? "Tap the drop to download your dashboard"
                : brain.status === "running"
                  ? `Working through ${brain.completedRoles.length}/${totalRoles} agents…`
                  : brain.status === "error"
                    ? `error: ${brain.reason ?? "unknown"}`
                    : "Ask a question above to begin."
            }
          />
        </Panel>

        <div className="hex-divider" />

        <Panel
          side="right"
          title="Large Language Model Question"
          subtitle={models?.baseline.label ?? "single strong model · end to end"}
        >
          <div
            style={{
              minHeight: 140,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              rowGap: 6,
            }}
          >
            <SpriteBee
              role="solo"
              size={96}
              active={baseline.status === "running"}
              done={baseline.status === "complete"}
              title="solo bee · single model"
            />
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontSize: 12,
                color: "var(--bark)",
                textAlign: "center",
              }}
            >
              {models?.baseline.label ?? "—"}
            </div>
            {models?.baseline.params && (
              <div
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  color: "var(--bark)",
                  fontFeatureSettings: '"tnum" 1',
                }}
              >
                {models.baseline.params.toUpperCase()} PARAMS
              </div>
            )}
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
            filename="LLM-METHOD.html"
            caption={
              baseline.status === "complete"
                ? "Tap the drop to download your dashboard"
                : baseline.status === "running"
                  ? "The single model is working…"
                  : baseline.status === "error"
                    ? `error: ${baseline.reason ?? "unknown"}`
                    : "Ask a question above to begin."
            }
          />
        </Panel>
      </div>

      {/* analytics card */}
      <AnalyticsCard totals={totals} />

      {/* reset */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          columnGap: 16,
        }}
      >
        <HexButton onClick={reset} size="sm" variant="outline" disabled={!runId && !question}>
          Reset
        </HexButton>
        {submitError && (
          <span
            style={{
              fontSize: 12,
              color: "var(--bark-soft)",
              fontStyle: "italic",
            }}
          >
            {submitError}
          </span>
        )}
      </div>
    </main>
  );
}

// --- Panel scaffold ---

interface PanelProps {
  side: "left" | "right";
  title: string;
  subtitle: string;
  children: React.ReactNode;
}

function Panel({ side, title, subtitle, children }: PanelProps): JSX.Element {
  return (
    <section
      style={{
        padding: side === "left" ? "0 24px 0 0" : "0 0 0 24px",
        display: "grid",
        // header → top content (1fr) → drop (auto): the 1fr row absorbs slack
        // so the drop row aligns horizontally with the other panel's drop.
        gridTemplateRows: "auto 1fr auto",
        rowGap: 10,
        minHeight: 0,
      }}
    >
      <header style={{ display: "grid", rowGap: 2 }}>
        <h2
          className="display"
          style={{
            margin: 0,
            fontSize: 22,
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
            fontSize: 12,
          }}
        >
          {subtitle}
        </div>
      </header>
      {children}
    </section>
  );
}
