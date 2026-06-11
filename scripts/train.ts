/**
 * scripts/train.ts — The Hive Self-Improvement Training Loop
 *
 * Runs N questions sequentially against the brain lane, triggering
 * self-improvement (prompt surgery, glossary growth, apprentice-master)
 * after each one. Tracks metrics per question and generates a report
 * showing how the system improves (or regresses) over time.
 *
 * Usage:
 *   npx tsx scripts/train.ts [--questions N] [--file path/to/questions.json]
 *
 * Requires: DATABASE_URL (Postgres with Northwind loaded) + OPENROUTER_API_KEY
 */
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { getPool, getDataPool, closePool } from "../src/db/client.js";
import { introspectSchema } from "../src/db/introspect.js";
import { buildContext } from "../src/context/contextProvider.js";
import {
  getLedger,
  resetLedger,
} from "../src/models/index.js";
import {
  loadLatestPrompt,
  performSurgery,
  loadPromptHistory,
} from "../src/agents/promptSurgery.js";
import {
  detectUnknownTerms,
  growGlossary,
  storeLearnedExample,
} from "../src/agents/glossaryGrowth.js";
import { runSqlAgent, type SqlAgentResult } from "../src/agents/sqlAgent.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TrainingQuestion {
  id: number;
  style: string; // ambiguous | precise | jargon | obscure
  question: string;
  concepts: string[];
}

interface QuestionMetrics {
  questionId: number;
  question: string;
  style: string; // ambiguous | precise | jargon | obscure
  // Tokens & cost
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  // Accuracy
  sqlSuccess: boolean;
  firstAttemptPass: boolean;
  escalationUsed: boolean;
  attempts: number;
  failureReason?: string;
  // Prompt state
  promptGeneration: number; // which generation of the system prompt was active
  // Learning triggered
  promptSurgeryTriggered: boolean;
  glossaryTermsAdded: string[];
  learnedExampleStored: boolean;
  // Timing
  elapsedMs: number;
}

interface PromptSnapshot {
  afterQuestionId: number;
  role: string;
  generation: number;
  systemPrompt: string;
  diagnosis: string | null;
  winRate: number | null;
}

interface TrainingReport {
  startedAt: string;
  finishedAt: string;
  totalQuestions: number;
  questionsRun: number;
  dataset: string;
  // Per-question metrics
  metrics: QuestionMetrics[];
  // Prompt evolution over time
  promptEvolution: PromptSnapshot[];
  // Summary stats
  summary: {
    totalTokens: number;
    totalCostUsd: number;
    overallSuccessRate: number;
    firstAttemptPassRate: number;
    escalationRate: number;
    avgTokensPerQuestion: number;
    avgCostPerQuestion: number;
    glossaryTermsLearned: number;
    promptSurgeries: number;
    learnedExamples: number;
    // Improvement trajectory (first 3 vs last 3)
    firstTenSuccessRate: number;
    lastTenSuccessRate: number;
    firstTenAvgTokens: number;
    lastTenAvgTokens: number;
    firstTenAvgCost: number;
    lastTenAvgCost: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseArgs(): { numQuestions: number; questionsFile: string } {
  const args = process.argv.slice(2);
  let numQuestions = 75;
  let questionsFile = resolve(__dirname, "../data/training_questions.json");

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--questions" && args[i + 1]) {
      numQuestions = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--file" && args[i + 1]) {
      questionsFile = resolve(args[i + 1]);
      i++;
    }
  }
  return { numQuestions, questionsFile };
}

function loadQuestions(file: string, limit: number): TrainingQuestion[] {
  const raw = JSON.parse(readFileSync(file, "utf-8")) as {
    questions: TrainingQuestion[];
  };
  return raw.questions.slice(0, limit);
}

/** Capture prompt state for all roles that have been surgically modified. */
async function capturePromptSnapshots(
  pool: Pool,
  afterQuestionId: number,
): Promise<PromptSnapshot[]> {
  const roles = ["sqlGen", "planner", "insight", "dashboardPlan", "codeGen"];
  const snapshots: PromptSnapshot[] = [];

  for (const role of roles) {
    const latest = await loadLatestPrompt(pool, role);
    if (latest) {
      snapshots.push({
        afterQuestionId,
        role,
        generation: latest.generation,
        systemPrompt: latest.systemPrompt,
        diagnosis: latest.diagnosis,
        winRate: latest.winRate,
      });
    }
  }
  return snapshots;
}

function computeSummary(metrics: QuestionMetrics[]): TrainingReport["summary"] {
  const n = metrics.length;
  const totalTokens = metrics.reduce((s, m) => s + m.totalTokens, 0);
  const totalCostUsd = metrics.reduce((s, m) => s + m.costUsd, 0);
  const successes = metrics.filter((m) => m.sqlSuccess).length;
  const firstPasses = metrics.filter((m) => m.firstAttemptPass).length;
  const escalations = metrics.filter((m) => m.escalationUsed).length;
  const glossaryTerms = metrics.reduce(
    (s, m) => s + m.glossaryTermsAdded.length,
    0,
  );
  const surgeries = metrics.filter((m) => m.promptSurgeryTriggered).length;
  const examples = metrics.filter((m) => m.learnedExampleStored).length;

  const first10 = metrics.slice(0, Math.min(3, n));
  const last10 = metrics.slice(Math.max(0, n - 3));

  const rate = (arr: QuestionMetrics[]) =>
    arr.length > 0 ? arr.filter((m) => m.sqlSuccess).length / arr.length : 0;
  const avgTok = (arr: QuestionMetrics[]) =>
    arr.length > 0
      ? arr.reduce((s, m) => s + m.totalTokens, 0) / arr.length
      : 0;
  const avgCost = (arr: QuestionMetrics[]) =>
    arr.length > 0 ? arr.reduce((s, m) => s + m.costUsd, 0) / arr.length : 0;

  return {
    totalTokens,
    totalCostUsd,
    overallSuccessRate: n > 0 ? successes / n : 0,
    firstAttemptPassRate: n > 0 ? firstPasses / n : 0,
    escalationRate: n > 0 ? escalations / n : 0,
    avgTokensPerQuestion: n > 0 ? totalTokens / n : 0,
    avgCostPerQuestion: n > 0 ? totalCostUsd / n : 0,
    glossaryTermsLearned: glossaryTerms,
    promptSurgeries: surgeries,
    learnedExamples: examples,
    firstTenSuccessRate: rate(first10),
    lastTenSuccessRate: rate(last10),
    firstTenAvgTokens: avgTok(first10),
    lastTenAvgTokens: avgTok(last10),
    firstTenAvgCost: avgCost(first10),
    lastTenAvgCost: avgCost(last10),
  };
}

// ---------------------------------------------------------------------------
// Main training loop
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { numQuestions, questionsFile } = parseArgs();
  const questions = loadQuestions(questionsFile, numQuestions);

  console.log(`\n🧠 Hive Training Loop`);
  console.log(`   Dataset: Northwind`);
  console.log(`   Questions: ${questions.length}`);
  console.log(`   Mode: Autoregressive self-improvement\n`);

  const pool = getPool(); // APP db — Hive's own brain-state tables
  const dataPool = getDataPool(); // DATA db — the analytics database questions run against
  const allMetrics: QuestionMetrics[] = [];
  const allPromptSnapshots: PromptSnapshot[] = [];
  const startedAt = new Date().toISOString();

  // Build context once: schema from the DATA db, glossary from the APP db.
  const context = await buildContext(dataPool, pool);

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const t0 = Date.now();
    resetLedger();

    console.log(
      `\n[${ i + 1}/${questions.length}] (${q.style}) "${q.question}"`,
    );

    // --- Load the latest evolved prompt (autoregressive: each question sees improvements from previous) ---
    let systemPromptOverride: string | undefined;
    const latestPrompt = await loadLatestPrompt(pool, "sqlGen");
    if (latestPrompt) {
      systemPromptOverride = latestPrompt.systemPrompt;
      console.log(`   📝 Using evolved prompt (gen ${latestPrompt.generation})`);
    }

    // --- Run the SQL agent for this question ---
    let sqlResult: SqlAgentResult;
    try {
      sqlResult = await runSqlAgent(q.question, {
        context,
        db: dataPool,
        systemPromptOverride,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`   ❌ Error: ${msg}`);
      const ledger = getLedger();
      allMetrics.push({
        questionId: q.id,
        question: q.question,
        style: q.style,
        totalTokens: ledger.reduce(
          (s, e) => s + e.promptTokens + e.completionTokens,
          0,
        ),
        promptTokens: ledger.reduce((s, e) => s + e.promptTokens, 0),
        completionTokens: ledger.reduce((s, e) => s + e.completionTokens, 0),
        costUsd: ledger.reduce((s, e) => s + e.costUsd, 0),
        sqlSuccess: false,
        firstAttemptPass: false,
        escalationUsed: false,
        attempts: 0,
        failureReason: msg,
        promptGeneration: latestPrompt?.generation ?? 0,
        promptSurgeryTriggered: false,
        glossaryTermsAdded: [],
        learnedExampleStored: false,
        elapsedMs: Date.now() - t0,
      });
      continue;
    }

    const ledger = getLedger();
    const totalTokens = ledger.reduce(
      (s, e) => s + e.promptTokens + e.completionTokens,
      0,
    );
    const firstAttemptPass =
      sqlResult.ok && sqlResult.attempts.length === 1 && sqlResult.attempts[0].ok;
    const escalationUsed = sqlResult.attempts.some(
      (a) => a.phase === "escalation",
    );

    const status = sqlResult.ok ? "✅" : "❌";
    console.log(
      `   ${status} ${sqlResult.attempts.length} attempt(s), ` +
        `${totalTokens} tokens, $${ledger.reduce((s, e) => s + e.costUsd, 0).toFixed(4)}`,
    );

    // --- Self-improvement triggers ---
    let promptSurgeryTriggered = false;
    let glossaryTermsAdded: string[] = [];
    let learnedExampleStored = false;

    if (!sqlResult.ok) {
      // 1. Prompt Surgery: rewrite the sqlGen system prompt
      console.log(`   🔧 Triggering prompt surgery...`);
      try {
        const currentPrompt = await loadLatestPrompt(pool, "sqlGen");
        const promptText =
          currentPrompt?.systemPrompt ??
          "You are a SQL generation agent. Generate read-only PostgreSQL SQL for the given question.";
        await performSurgery(pool, {
          role: "sqlGen",
          currentPrompt: promptText,
          userMessage: q.question,
          rejectedOutput:
            sqlResult.attempts.at(-1)?.rawOutput ?? "",
          verifierReason: sqlResult.reason ?? "verification failed",
        });
        promptSurgeryTriggered = true;
        console.log(`   🔧 Prompt surgery complete (new generation saved)`);
      } catch (err) {
        console.log(
          `   🔧 Prompt surgery failed: ${err instanceof Error ? err.message : err}`,
        );
      }

      // 2. Glossary Growth: detect unknown terms
      try {
        const unknowns = await detectUnknownTerms(pool, q.question);
        for (const term of unknowns.slice(0, 3)) {
          // limit to 3 per question
          console.log(`   📚 Researching term: "${term}"`);
          const schema = await introspectSchema(dataPool);
          const schemaStr = schema.tables
            .map((t) => `${t.name}(${t.columns.map((c) => c.name).join(", ")})`)
            .join("; ");
          await growGlossary(pool, { term, schema: schemaStr, question: q.question });
          glossaryTermsAdded.push(term);
        }
      } catch (err) {
        console.log(
          `   📚 Glossary growth failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    } else if (escalationUsed) {
      // 3. Apprentice-Master: cheap failed, escalation succeeded
      const badAttempt = sqlResult.attempts.find(
        (a) => a.phase === "cheap" && !a.ok,
      );
      const goodAttempt = sqlResult.attempts.find(
        (a) => a.phase === "escalation" && a.ok,
      );
      if (badAttempt && goodAttempt) {
        console.log(`   🎓 Storing learned example (apprentice-master)...`);
        try {
          await storeLearnedExample(
            pool,
            "sqlGen",
            q.question,
            badAttempt.rawOutput,
            goodAttempt.rawOutput,
          );
          learnedExampleStored = true;
        } catch (err) {
          console.log(
            `   🎓 Failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    }

    allMetrics.push({
      questionId: q.id,
      question: q.question,
      style: q.style,
      totalTokens,
      promptTokens: ledger.reduce((s, e) => s + e.promptTokens, 0),
      completionTokens: ledger.reduce((s, e) => s + e.completionTokens, 0),
      costUsd: ledger.reduce((s, e) => s + e.costUsd, 0),
      sqlSuccess: sqlResult.ok,
      firstAttemptPass: !!firstAttemptPass,
      escalationUsed,
      attempts: sqlResult.attempts.length,
      ...(sqlResult.ok ? {} : { failureReason: sqlResult.reason }),
      promptGeneration: latestPrompt?.generation ?? 0,
      promptSurgeryTriggered,
      glossaryTermsAdded,
      learnedExampleStored,
      elapsedMs: Date.now() - t0,
    });

    // Capture prompt snapshots after any surgery
    if (promptSurgeryTriggered) {
      const snapshots = await capturePromptSnapshots(pool, q.id);
      allPromptSnapshots.push(...snapshots);
    }

    // Print running stats every 10 questions
    if ((i + 1) % 10 === 0) {
      const recent = allMetrics.slice(-10);
      const recentSuccess = recent.filter((m) => m.sqlSuccess).length;
      const recentTokens =
        recent.reduce((s, m) => s + m.totalTokens, 0) / recent.length;
      console.log(
        `\n   📊 Last 10: ${recentSuccess}/10 success, ` +
          `avg ${Math.round(recentTokens)} tokens/q`,
      );
    }
  }

  // --- Final prompt snapshot ---
  const finalSnapshots = await capturePromptSnapshots(pool, -1);
  allPromptSnapshots.push(...finalSnapshots);

  // --- Get full prompt history for the report ---
  const promptHistory = await loadPromptHistory(pool, "sqlGen");
  const promptEvolutionFull: PromptSnapshot[] = promptHistory.map((p) => ({
    afterQuestionId: -1, // history doesn't track which question triggered it
    role: "sqlGen",
    generation: p.generation,
    systemPrompt: p.systemPrompt,
    diagnosis: p.diagnosis,
    winRate: p.winRate,
  }));

  // --- Generate report ---
  const finishedAt = new Date().toISOString();
  const report: TrainingReport = {
    startedAt,
    finishedAt,
    totalQuestions: questions.length,
    questionsRun: allMetrics.length,
    dataset: "northwind",
    metrics: allMetrics,
    promptEvolution:
      promptEvolutionFull.length > 0 ? promptEvolutionFull : allPromptSnapshots,
    summary: computeSummary(allMetrics),
  };

  // Write report to disk
  mkdirSync(resolve(__dirname, "../data/reports"), { recursive: true });
  const reportPath = resolve(
    __dirname,
    `../data/reports/training_${Date.now()}.json`,
  );
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // Persist to database
  try {
    const { rows: runRows } = await pool.query<{ id: string }>(
      `INSERT INTO training_runs
         (started_at, finished_at, dataset, questions_total, questions_run,
          success_rate, first_attempt_rate, escalation_rate,
          total_tokens, total_cost_usd, prompt_surgeries,
          glossary_terms_added, learned_examples_stored)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        report.startedAt, report.finishedAt, report.dataset,
        report.totalQuestions, report.questionsRun,
        report.summary.overallSuccessRate, report.summary.firstAttemptPassRate,
        report.summary.escalationRate, report.summary.totalTokens,
        report.summary.totalCostUsd, report.summary.promptSurgeries,
        report.summary.glossaryTermsLearned, report.summary.learnedExamples,
      ],
    );
    const runId = runRows[0].id;

    // Persist per-question metrics
    for (let idx = 0; idx < allMetrics.length; idx++) {
      const m = allMetrics[idx];
      await pool.query(
        `INSERT INTO training_metrics
           (run_id, question_index, question_text, style,
            total_tokens, cost_usd, sql_success, first_attempt_pass,
            escalation_used, attempts, prompt_generation, failure_reason, elapsed_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          runId, idx + 1, m.question, m.style,
          m.totalTokens, m.costUsd, m.sqlSuccess, m.firstAttemptPass,
          m.escalationUsed, m.attempts,
          m.promptGeneration,
          m.failureReason ?? null, m.elapsedMs,
        ],
      );
    }
    console.log(`\n💾 Training run persisted to database (run_id: ${runId})`);
  } catch (err) {
    console.log(
      `\n⚠️  Could not persist to DB (tables may not exist): ${err instanceof Error ? err.message : err}`,
    );
  }

  // --- Print summary ---
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🧠 TRAINING COMPLETE`);
  console.log(`${"=".repeat(60)}`);
  console.log(`Questions run: ${report.questionsRun}`);
  console.log(
    `Overall success rate: ${(report.summary.overallSuccessRate * 100).toFixed(1)}%`,
  );
  console.log(
    `First-attempt pass rate: ${(report.summary.firstAttemptPassRate * 100).toFixed(1)}%`,
  );
  console.log(
    `Escalation rate: ${(report.summary.escalationRate * 100).toFixed(1)}%`,
  );
  console.log(`Total tokens: ${report.summary.totalTokens.toLocaleString()}`);
  console.log(`Total cost: $${report.summary.totalCostUsd.toFixed(4)}`);
  console.log(
    `Avg tokens/question: ${Math.round(report.summary.avgTokensPerQuestion)}`,
  );
  console.log(`Avg cost/question: $${report.summary.avgCostPerQuestion.toFixed(4)}`);
  console.log(`\n📈 IMPROVEMENT TRAJECTORY (first 3 vs last 3):`);
  console.log(
    `   Success rate: ${(report.summary.firstTenSuccessRate * 100).toFixed(1)}% → ${(report.summary.lastTenSuccessRate * 100).toFixed(1)}%`,
  );
  console.log(
    `   Avg tokens: ${Math.round(report.summary.firstTenAvgTokens)} → ${Math.round(report.summary.lastTenAvgTokens)}`,
  );
  console.log(
    `   Avg cost: $${report.summary.firstTenAvgCost.toFixed(4)} → $${report.summary.lastTenAvgCost.toFixed(4)}`,
  );
  console.log(`\n🔧 Self-improvement actions:`);
  console.log(`   Prompt surgeries: ${report.summary.promptSurgeries}`);
  console.log(`   Glossary terms learned: ${report.summary.glossaryTermsLearned}`);
  console.log(`   Learned examples stored: ${report.summary.learnedExamples}`);
  console.log(
    `\n📝 Prompt evolved through ${promptEvolutionFull.length || allPromptSnapshots.length} generation(s)`,
  );
  if (promptEvolutionFull.length > 0) {
    console.log(`   Latest diagnosis: "${promptEvolutionFull.at(-1)?.diagnosis ?? "none"}"`);
  }
  console.log(`\n📄 Full report: ${reportPath}`);

  await closePool();
}

main().catch((err) => {
  console.error("Training loop fatal error:", err);
  process.exit(1);
});
