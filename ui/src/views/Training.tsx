// Training view: kick off training, watch live progress, view report.
import { useEffect, useRef, useState } from "react";
import {
  fetchPromptEdition,
  fetchTrainingStatus,
  startTraining,
  subscribeTraining,
  type PromptEdition,
  type TrainingMetricEvent,
} from "../lib/api";
import { HexButton } from "../components/HexButton";

interface Props {
  onBack: () => void;
}

export function Training({ onBack }: Props): JSX.Element {
  const [edition, setEdition] = useState<PromptEdition | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "complete" | "error">("idle");
  const [trainId, setTrainId] = useState<string | null>(null);
  const [events, setEvents] = useState<TrainingMetricEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [numQuestions, setNumQuestions] = useState(75);
  const closeRef = useRef<(() => void) | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchPromptEdition().then(setEdition).catch(() => {});
    fetchTrainingStatus().then((s) => {
      if (s.active && s.activeId) {
        setStatus("running");
        setTrainId(s.activeId);
        connectToStream(s.activeId);
      }
    }).catch(() => {});
    return () => { closeRef.current?.(); };
  }, []);

  // Auto-scroll feed
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [events]);

  function connectToStream(id: string) {
    closeRef.current?.();
    closeRef.current = subscribeTraining(
      id,
      (ev) => {
        setEvents((prev) => [...prev, ev]);
        if (ev.type === "training_complete") {
          setStatus("complete");
        }
        if (ev.type === "prompt_evolved") {
          // Refresh edition
          fetchPromptEdition().then(setEdition).catch(() => {});
        }
      },
      (err) => setError(err.message),
    );
  }

  async function handleStart() {
    setError(null);
    setEvents([]);
    setStatus("running");
    try {
      const id = await startTraining(numQuestions);
      setTrainId(id);
      connectToStream(id);
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    }
  }

  const results = events.filter((e) => e.type === "question_result");
  const successes = results.filter((r) => r.success).length;
  const total = results.length;
  const summaryEvent = events.find((e) => e.type === "training_complete");
  const summary = summaryEvent?.summary;
  const promptEvents = events.filter((e) => e.type === "prompt_evolved");

  return (
    <main style={{ padding: "24px clamp(20px, 3.4vw, 48px)", maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 className="display" style={{ margin: 0, fontSize: 28 }}>Training Loop</h1>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            Autoregressive self-improvement · Northwind dataset
          </p>
        </div>
        <HexButton onClick={onBack} size="sm" variant="outline">Back</HexButton>
      </div>

      {/* Prompt Edition Badge */}
      <div style={{
        background: "var(--card, #1e293b)",
        border: "1px solid var(--line, #334155)",
        borderRadius: 8,
        padding: "12px 16px",
        marginBottom: 16,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}>
        <div style={{
          background: "#6366f1",
          color: "white",
          borderRadius: 4,
          padding: "2px 8px",
          fontSize: 12,
          fontWeight: 700,
          fontFamily: "monospace",
        }}>
          Gen {edition?.generation ?? 0}
        </div>
        <div style={{ fontSize: 13, color: "var(--bark, #e2e8f0)" }}>
          <strong>System Prompt Edition:</strong>{" "}
          {edition?.generation === 0
            ? "Default (no modifications yet)"
            : edition?.diagnosis ?? "Modified"}
        </div>
        {edition?.winRate !== null && edition?.winRate !== undefined && (
          <div style={{ marginLeft: "auto", fontSize: 12, color: "#10b981", fontFamily: "monospace" }}>
            {(edition.winRate * 100).toFixed(0)}% win rate
          </div>
        )}
      </div>

      {/* Controls */}
      {status === "idle" && (
        <div style={{
          background: "var(--card, #1e293b)",
          border: "1px solid var(--line, #334155)",
          borderRadius: 8,
          padding: 20,
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, marginBottom: 8, color: "var(--bark, #e2e8f0)" }}>
              Run <strong>{numQuestions}</strong> training questions through the SQL agent.
              The system will improve its prompt after each failure.
            </div>
            <input
              type="range"
              min={5}
              max={75}
              step={5}
              value={numQuestions}
              onChange={(e) => setNumQuestions(Number(e.target.value))}
              style={{ width: "100%", maxWidth: 300 }}
            />
          </div>
          <HexButton onClick={handleStart} size="md">Start Training</HexButton>
        </div>
      )}

      {error && (
        <div style={{ color: "#f87171", fontSize: 13, marginBottom: 12 }}>{error}</div>
      )}

      {/* Progress bar */}
      {(status === "running" || status === "complete") && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
            <span style={{ color: "var(--bark, #e2e8f0)" }}>
              {status === "running" ? `Training... ${total}/${numQuestions}` : `Complete · ${total} questions`}
            </span>
            <span style={{ color: "#10b981", fontFamily: "monospace" }}>
              {successes}/{total} passed ({total > 0 ? ((successes / total) * 100).toFixed(0) : 0}%)
            </span>
          </div>
          <div style={{ height: 6, background: "#334155", borderRadius: 3 }}>
            <div style={{
              height: "100%",
              width: `${total > 0 ? (total / numQuestions) * 100 : 0}%`,
              background: status === "complete" ? "#10b981" : "#6366f1",
              borderRadius: 3,
              transition: "width 0.3s",
            }} />
          </div>
        </div>
      )}

      {/* Live feed */}
      {events.length > 0 && (
        <div
          ref={feedRef}
          style={{
            background: "var(--card, #1e293b)",
            border: "1px solid var(--line, #334155)",
            borderRadius: 8,
            padding: 12,
            maxHeight: 320,
            overflowY: "auto",
            marginBottom: 16,
            fontFamily: "monospace",
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          {events.map((ev, i) => (
            <div key={i} style={{ color: eventColor(ev) }}>
              {formatEvent(ev)}
            </div>
          ))}
        </div>
      )}

      {/* Summary report */}
      {summary && (
        <div style={{ marginBottom: 16 }}>
          <h3 className="display" style={{ fontSize: 18, margin: "0 0 12px" }}>Training Report</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
            <StatCard label="Success Rate" value={`${(summary.overallSuccessRate * 100).toFixed(1)}%`} color="#10b981" />
            <StatCard label="First-Attempt Pass" value={`${(summary.firstAttemptPassRate * 100).toFixed(1)}%`} color="#6366f1" />
            <StatCard label="Escalation Rate" value={`${(summary.escalationRate * 100).toFixed(1)}%`} color="#f59e0b" />
            <StatCard label="Total Cost" value={`$${summary.totalCostUsd.toFixed(4)}`} color="#ec4899" />
            <StatCard label="Total Tokens" value={summary.totalTokens.toLocaleString()} color="#8b5cf6" />
            <StatCard label="Prompt Surgeries" value={String(summary.promptSurgeries)} color="#f87171" />
            <StatCard label="Glossary Terms" value={String(summary.glossaryTermsLearned)} color="#3b82f6" />
            <StatCard label="Learned Examples" value={String(summary.learnedExamples)} color="#10b981" />
          </div>

          {/* Improvement trajectory */}
          <div style={{
            marginTop: 16,
            background: "var(--card, #1e293b)",
            border: "1px solid var(--line, #334155)",
            borderRadius: 8,
            padding: 16,
          }}>
            <h4 style={{ margin: "0 0 8px", fontSize: 14, color: "var(--bark, #e2e8f0)" }}>
              Improvement Trajectory (first 10 → last 10)
            </h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, textAlign: "center" }}>
              <div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>Success Rate</div>
                <div style={{ fontSize: 16 }}>
                  <span style={{ color: "#f87171" }}>{(summary.firstTenSuccessRate * 100).toFixed(0)}%</span>
                  {" → "}
                  <span style={{ color: "#10b981" }}>{(summary.lastTenSuccessRate * 100).toFixed(0)}%</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>Avg Tokens</div>
                <div style={{ fontSize: 16 }}>
                  <span style={{ color: "#f87171" }}>{Math.round(summary.firstTenAvgTokens)}</span>
                  {" → "}
                  <span style={{ color: "#10b981" }}>{Math.round(summary.lastTenAvgTokens)}</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>Prompt Gen</div>
                <div style={{ fontSize: 16, color: "#6366f1" }}>
                  0 → {promptEvents.length > 0 ? promptEvents[promptEvents.length - 1].newGeneration : 0}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Prompt Evolution Timeline */}
      {promptEvents.length > 0 && (
        <div style={{
          background: "var(--card, #1e293b)",
          border: "1px solid var(--line, #334155)",
          borderRadius: 8,
          padding: 16,
          marginBottom: 16,
        }}>
          <h4 style={{ margin: "0 0 12px", fontSize: 14, color: "var(--bark, #e2e8f0)" }}>
            Prompt Evolution ({promptEvents.length} surgeries)
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {promptEvents.map((ev, i) => (
              <div key={i} style={{ borderLeft: "2px solid #6366f1", paddingLeft: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    background: "#334155",
                    borderRadius: 3,
                    padding: "1px 6px",
                    fontSize: 11,
                    fontFamily: "monospace",
                  }}>
                    Gen {ev.newGeneration}
                  </span>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>
                    after Q{ev.questionIndex}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "#e2e8f0", marginTop: 2 }}>
                  {ev.diagnosis ?? "—"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reset */}
      {status === "complete" && (
        <div style={{ textAlign: "center" }}>
          <HexButton onClick={() => { setStatus("idle"); setEvents([]); setTrainId(null); }} size="sm" variant="outline">
            Run Again
          </HexButton>
        </div>
      )}
    </main>
  );
}

// --- Helpers ---

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      background: "var(--card, #1e293b)",
      border: "1px solid var(--line, #334155)",
      borderRadius: 8,
      padding: 12,
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: "monospace" }}>{value}</div>
      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function eventColor(ev: TrainingMetricEvent): string {
  if (ev.type === "question_start") return "#94a3b8";
  if (ev.type === "prompt_evolved") return "#6366f1";
  if (ev.type === "training_complete") return "#10b981";
  if (ev.type === "question_result") return ev.success ? "#10b981" : "#f87171";
  return "#e2e8f0";
}

function formatEvent(ev: TrainingMetricEvent): string {
  switch (ev.type) {
    case "question_start":
      return `[${ev.questionIndex}/${ev.totalQuestions}] (${ev.style}) "${ev.question}"`;
    case "question_result":
      const icon = ev.success ? "PASS" : "FAIL";
      const tokens = ev.totalTokens?.toLocaleString() ?? "?";
      const cost = ev.costUsd !== undefined ? `$${ev.costUsd.toFixed(4)}` : "";
      const extras: string[] = [];
      if (ev.escalationUsed) extras.push("escalated");
      if (ev.promptSurgeryTriggered) extras.push("surgery");
      if (ev.glossaryTermsAdded?.length) extras.push(`+${ev.glossaryTermsAdded.length} terms`);
      if (ev.learnedExampleStored) extras.push("learned");
      return `  ${icon} · ${ev.attempts} attempts · ${tokens} tok · ${cost}${extras.length ? ` · ${extras.join(", ")}` : ""}`;
    case "prompt_evolved":
      return `  PROMPT → Gen ${ev.newGeneration}: "${ev.diagnosis}"`;
    case "training_complete":
      return `\nTRAINING COMPLETE — ${ev.summary?.questionsRun} questions, ${((ev.summary?.overallSuccessRate ?? 0) * 100).toFixed(1)}% success`;
    default:
      return JSON.stringify(ev);
  }
}
