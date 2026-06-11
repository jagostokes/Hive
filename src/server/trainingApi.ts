// server/trainingApi: HTTP + SSE endpoints for the training loop, exposed to the
// UI so users can kick off training, watch it live, and review reports.
//
// Endpoints:
//   GET  /api/prompt-edition      — current prompt generation info for sqlGen
//   POST /api/train/start         — kick off a training run (returns { runId })
//   GET  /api/train/:id/events    — SSE stream of per-question progress
//   GET  /api/train/reports       — list completed training reports
//   GET  /api/train/report/:id    — get a specific training report JSON
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { getPool, getDataPool } from "../db/client.js";
import { buildContext } from "../context/contextProvider.js";
import { introspectSchema } from "../db/introspect.js";
import {
  loadLatestPrompt,
  performSurgery,
} from "../agents/promptSurgery.js";
import {
  detectUnknownTerms,
  growGlossary,
  storeLearnedExample,
} from "../agents/glossaryGrowth.js";
import { runSqlAgent } from "../agents/sqlAgent.js";
import { getLedger, resetLedger } from "../models/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrainingMetricEvent {
  type: "question_start" | "question_result" | "training_complete" | "prompt_evolved";
  questionIndex: number;
  totalQuestions: number;
  question?: string;
  style?: string;
  // Result fields (for question_result)
  success?: boolean;
  firstAttemptPass?: boolean;
  escalationUsed?: boolean;
  attempts?: number;
  totalTokens?: number;
  costUsd?: number;
  promptGeneration?: number;
  promptSurgeryTriggered?: boolean;
  glossaryTermsAdded?: string[];
  learnedExampleStored?: boolean;
  elapsedMs?: number;
  failureReason?: string;
  // Summary fields (for training_complete)
  summary?: TrainingSummary;
  // Prompt evolution (for prompt_evolved)
  diagnosis?: string;
  newGeneration?: number;
}

interface TrainingSummary {
  questionsRun: number;
  overallSuccessRate: number;
  firstAttemptPassRate: number;
  escalationRate: number;
  totalTokens: number;
  totalCostUsd: number;
  promptSurgeries: number;
  glossaryTermsLearned: number;
  learnedExamples: number;
  firstTenSuccessRate: number;
  lastTenSuccessRate: number;
  firstTenAvgTokens: number;
  lastTenAvgTokens: number;
}

interface TrainingQuestion {
  id: number;
  style: string;
  question: string;
  concepts: string[];
}

// ---------------------------------------------------------------------------
// Training state
// ---------------------------------------------------------------------------

interface TrainingRun {
  id: string;
  status: "running" | "complete" | "error";
  startedAt: string;
  finishedAt: string | null;
  totalQuestions: number;
  questionsRun: number;
  metrics: TrainingMetricEvent[];
}

const trainingRuns = new Map<string, TrainingRun>();
export const trainingEmitter = new EventEmitter();
trainingEmitter.setMaxListeners(50);

let activeTrainingId: string | null = null;

// ---------------------------------------------------------------------------
// Prompt edition endpoint data
// ---------------------------------------------------------------------------

export async function getPromptEdition(): Promise<{
  generation: number;
  diagnosis: string | null;
  winRate: number | null;
  createdAt: string | null;
} | null> {
  const pool = getPool();
  const latest = await loadLatestPrompt(pool, "sqlGen");
  if (!latest) return null;
  return {
    generation: latest.generation,
    diagnosis: latest.diagnosis,
    winRate: latest.winRate,
    createdAt: latest.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Training loop (runs in background)
// ---------------------------------------------------------------------------

export function startTraining(numQuestions: number): string {
  if (activeTrainingId) {
    throw new Error("Training already in progress");
  }

  const id = `train_${Date.now()}`;
  const run: TrainingRun = {
    id,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    totalQuestions: numQuestions,
    questionsRun: 0,
    metrics: [],
  };
  trainingRuns.set(id, run);
  activeTrainingId = id;

  // Fire and forget — the loop runs in background, emitting events via SSE
  runTrainingLoop(id, numQuestions).catch((err) => {
    const r = trainingRuns.get(id);
    if (r) {
      r.status = "error";
      r.finishedAt = new Date().toISOString();
    }
    activeTrainingId = null;
    trainingEmitter.emit(`train:${id}`, {
      type: "training_complete",
      questionIndex: -1,
      totalQuestions: numQuestions,
      failureReason: err instanceof Error ? err.message : String(err),
    } satisfies TrainingMetricEvent);
  });

  return id;
}

async function runTrainingLoop(runId: string, numQuestions: number): Promise<void> {
  const pool = getPool(); // APP db — Hive's own brain-state tables
  const dataPool = getDataPool(); // DATA db — the analytics database questions run against

  // Load questions
  const here = path.dirname(fileURLToPath(import.meta.url));
  const questionsPath = resolve(here, "../../data/training_questions.json");
  const raw = JSON.parse(readFileSync(questionsPath, "utf-8")) as {
    questions: TrainingQuestion[];
  };
  const questions = raw.questions.slice(0, numQuestions);

  // Schema from the DATA db, glossary from the APP db.
  const context = await buildContext(dataPool, pool);
  const run = trainingRuns.get(runId)!;

  let successCount = 0;
  let firstAttemptCount = 0;
  let escalationCount = 0;
  let totalTokens = 0;
  let totalCost = 0;
  let surgeryCount = 0;
  let glossaryCount = 0;
  let exampleCount = 0;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    resetLedger();

    // Emit question_start
    const startEvent: TrainingMetricEvent = {
      type: "question_start",
      questionIndex: i + 1,
      totalQuestions: questions.length,
      question: q.question,
      style: q.style,
    };
    run.metrics.push(startEvent);
    trainingEmitter.emit(`train:${runId}`, startEvent);

    // Load latest evolved prompt
    const latestPrompt = await loadLatestPrompt(pool, "sqlGen");
    const systemPromptOverride = latestPrompt?.systemPrompt;
    const promptGen = latestPrompt?.generation ?? 0;

    const t0 = Date.now();
    let success = false;
    let firstAttemptPass = false;
    let escalationUsed = false;
    let attempts = 0;
    let failureReason: string | undefined;
    let promptSurgeryTriggered = false;
    let glossaryTermsAdded: string[] = [];
    let learnedExampleStored = false;

    try {
      const sqlResult = await runSqlAgent(q.question, {
        context,
        db: dataPool,
        systemPromptOverride,
      });

      const ledger = getLedger();
      const qTokens = ledger.reduce((s, e) => s + e.promptTokens + e.completionTokens, 0);
      const qCost = ledger.reduce((s, e) => s + e.costUsd, 0);
      totalTokens += qTokens;
      totalCost += qCost;

      success = sqlResult.ok;
      attempts = sqlResult.attempts.length;
      firstAttemptPass = sqlResult.ok && attempts === 1 && sqlResult.attempts[0].ok;
      escalationUsed = sqlResult.attempts.some((a) => a.phase === "escalation");

      if (success) successCount++;
      if (firstAttemptPass) firstAttemptCount++;
      if (escalationUsed) escalationCount++;

      if (!sqlResult.ok) {
        failureReason = sqlResult.reason;

        // Prompt Surgery
        try {
          const currentPrompt = latestPrompt?.systemPrompt ??
            "You are a SQL generation agent. Generate read-only PostgreSQL SQL for the given question.";
          await performSurgery(pool, {
            role: "sqlGen",
            currentPrompt,
            userMessage: q.question,
            rejectedOutput: sqlResult.attempts.at(-1)?.rawOutput ?? "",
            verifierReason: sqlResult.reason ?? "verification failed",
          });
          promptSurgeryTriggered = true;
          surgeryCount++;

          // Emit prompt evolution event
          const newPrompt = await loadLatestPrompt(pool, "sqlGen");
          if (newPrompt) {
            const evolveEvent: TrainingMetricEvent = {
              type: "prompt_evolved",
              questionIndex: i + 1,
              totalQuestions: questions.length,
              diagnosis: newPrompt.diagnosis ?? undefined,
              newGeneration: newPrompt.generation,
              promptGeneration: newPrompt.generation,
            };
            run.metrics.push(evolveEvent);
            trainingEmitter.emit(`train:${runId}`, evolveEvent);
          }
        } catch {}

        // Glossary Growth
        try {
          const unknowns = await detectUnknownTerms(pool, q.question);
          for (const term of unknowns.slice(0, 3)) {
            const schema = await introspectSchema(dataPool);
            const schemaStr = schema.tables
              .map((t) => `${t.name}(${t.columns.map((c) => c.name).join(", ")})`)
              .join("; ");
            await growGlossary(pool, { term, schema: schemaStr, question: q.question });
            glossaryTermsAdded.push(term);
            glossaryCount++;
          }
        } catch {}
      } else if (escalationUsed) {
        // Apprentice-Master
        const badAttempt = sqlResult.attempts.find((a) => a.phase === "cheap" && !a.ok);
        const goodAttempt = sqlResult.attempts.find((a) => a.phase === "escalation" && a.ok);
        if (badAttempt && goodAttempt) {
          try {
            await storeLearnedExample(pool, "sqlGen", q.question, badAttempt.rawOutput, goodAttempt.rawOutput);
            learnedExampleStored = true;
            exampleCount++;
          } catch {}
        }
      }

      // Emit question_result
      const resultEvent: TrainingMetricEvent = {
        type: "question_result",
        questionIndex: i + 1,
        totalQuestions: questions.length,
        question: q.question,
        style: q.style,
        success,
        firstAttemptPass,
        escalationUsed,
        attempts,
        totalTokens: qTokens,
        costUsd: qCost,
        promptGeneration: promptGen,
        promptSurgeryTriggered,
        glossaryTermsAdded,
        learnedExampleStored,
        elapsedMs: Date.now() - t0,
        failureReason,
      };
      run.metrics.push(resultEvent);
      run.questionsRun = i + 1;
      trainingEmitter.emit(`train:${runId}`, resultEvent);
    } catch (err) {
      const ledger = getLedger();
      totalTokens += ledger.reduce((s, e) => s + e.promptTokens + e.completionTokens, 0);
      totalCost += ledger.reduce((s, e) => s + e.costUsd, 0);

      const resultEvent: TrainingMetricEvent = {
        type: "question_result",
        questionIndex: i + 1,
        totalQuestions: questions.length,
        question: q.question,
        style: q.style,
        success: false,
        firstAttemptPass: false,
        escalationUsed: false,
        attempts: 0,
        totalTokens: 0,
        costUsd: 0,
        promptGeneration: promptGen,
        promptSurgeryTriggered: false,
        glossaryTermsAdded: [],
        learnedExampleStored: false,
        elapsedMs: Date.now() - t0,
        failureReason: err instanceof Error ? err.message : String(err),
      };
      run.metrics.push(resultEvent);
      run.questionsRun = i + 1;
      trainingEmitter.emit(`train:${runId}`, resultEvent);
    }
  }

  // Compute summary
  const n = run.questionsRun;
  const results = run.metrics.filter((m) => m.type === "question_result");
  const first10 = results.slice(0, Math.min(3, results.length));
  const last10 = results.slice(Math.max(0, results.length - 3));

  const summary: TrainingSummary = {
    questionsRun: n,
    overallSuccessRate: n > 0 ? successCount / n : 0,
    firstAttemptPassRate: n > 0 ? firstAttemptCount / n : 0,
    escalationRate: n > 0 ? escalationCount / n : 0,
    totalTokens,
    totalCostUsd: totalCost,
    promptSurgeries: surgeryCount,
    glossaryTermsLearned: glossaryCount,
    learnedExamples: exampleCount,
    firstTenSuccessRate: first10.length > 0
      ? first10.filter((r) => r.success).length / first10.length
      : 0,
    lastTenSuccessRate: last10.length > 0
      ? last10.filter((r) => r.success).length / last10.length
      : 0,
    firstTenAvgTokens: first10.length > 0
      ? first10.reduce((s, r) => s + (r.totalTokens ?? 0), 0) / first10.length
      : 0,
    lastTenAvgTokens: last10.length > 0
      ? last10.reduce((s, r) => s + (r.totalTokens ?? 0), 0) / last10.length
      : 0,
  };

  run.status = "complete";
  run.finishedAt = new Date().toISOString();
  activeTrainingId = null;

  const completeEvent: TrainingMetricEvent = {
    type: "training_complete",
    questionIndex: n,
    totalQuestions: questions.length,
    summary,
  };
  run.metrics.push(completeEvent);
  trainingEmitter.emit(`train:${runId}`, completeEvent);
}

// ---------------------------------------------------------------------------
// Report access
// ---------------------------------------------------------------------------

export function getTrainingRun(id: string): TrainingRun | undefined {
  return trainingRuns.get(id);
}

export function listTrainingRuns(): Array<{ id: string; status: string; startedAt: string; questionsRun: number }> {
  return Array.from(trainingRuns.values()).map((r) => ({
    id: r.id,
    status: r.status,
    startedAt: r.startedAt,
    questionsRun: r.questionsRun,
  }));
}

export function isTrainingActive(): boolean {
  return activeTrainingId !== null;
}

export function getActiveTrainingId(): string | null {
  return activeTrainingId;
}
