# Hive — A Thesis on Cheap-First, Verifier-Gated Agent Swarms

## Thesis statement

> **A natural-language data question does not need a single expensive frontier
> model to answer it. If you decompose the question into narrowly-scoped
> sub-tasks, run each on the cheapest model that can plausibly do it, and gate
> every step on an *objective, deterministic verifier* — escalating to a stronger
> model only on a *verified* failure — you can produce the same artifact (a
> working dashboard) at a small fraction of the tokens and cost of a single
> strong-model baseline.**

Hive is the experimental apparatus that tests this claim. It runs two lanes over
the *same* question against the *same* Postgres database and measures both:

- **Brain lane** — a cheap-first swarm: decompose → per-sub-question SQL → insight
  → dashboard plan → code generation, with a deterministic verifier at every
  stage and capped escalation to mid-tier models.
- **Baseline lane** — a single strong model (`anthropic/claude-opus-4.8`) doing
  the whole task end-to-end in a tool-calling loop.

Both emit a self-contained HTML dashboard served on `localhost`. Every model call
in both lanes routes through one shared client that records `prompt_tokens`,
`completion_tokens`, and a USD cost computed from a single pricing table. The two
lanes are tagged `brain` / `baseline` in one shared ledger, so the side-by-side
token and cost comparison is read straight from real usage data — never mocked.

---

## 1. What the repo is doing

### 1.1 The core idea: "brain pattern"

The system is deliberately **domain-agnostic**. There are no hardcoded table or
column names anywhere; the schema is introspected at runtime and the question is
an input. The same code answers a question about e-commerce orders (the imported
Olist dataset in `archive/`) as it would about any other Postgres database.

The brain lane (`src/orchestrator/orchestrator.ts`) executes this pipeline:

```
question
  └─► planner            decompose into a DAG of sub-questions (groups run in order)
        └─► per sub-question, CONCURRENTLY, one full "lane":
              ├─ SQL agent     cache-first; generate → verify → retry → escalate
              ├─ insight agent  short finding; anti-hallucination verified
              └─ plan agent     chart spec; every referenced column verified
        └─► coalesce sub-question plans into ONE dashboard spec
        └─► codeGen           write a self-contained React/Chart.js dashboard
              └─ codeEdit      repair pass if the generated code fails to render
        └─► serve on localhost
```

Key design decisions, each load-bearing for the thesis:

- **One config file is the single source of truth** (`config/models.ts`). Model
  slugs, per-role pricing, loop caps, and the escalation map all live here.
  Swapping a model or repricing a role is a one-file edit; no model slug appears
  inline anywhere else in the codebase.

- **Role-tiered models.** Cheap roles do the bulk of the work
  (`qwen3-coder-30b` for SQL at \$0.07/\$0.27 per M tokens, `deepseek-v4-flash`
  for insight, `gemini-2.5-flash-lite` for dashboard plans). Escalation targets
  are *mid-tier, still-cheap* models — explicitly **not** the flagship baseline —
  so a brain-lane escalation never conflates the two lanes being measured.

- **Capped loops everywhere.** Every retry/escalate loop is bounded:
  `2 cheap attempts + 1 escalation, then stop` (`LOOP_CAPS`). The baseline's
  tool-calling loop is capped at 8 iterations. No unbounded spend is possible.

- **DAG dependencies enforce ordering, not data flow.** Dependent sub-questions
  run after their dependencies, but each generates SQL independently from the
  schema. This trades multi-step data threading for parallelism and simplicity —
  appropriate because most analytical questions are answerable by independent
  queries against one schema.

### 1.2 Verifiers are the safety mechanism that makes "cheap-first" safe

The reason a cheap model is acceptable is that its output is checked by a
**pure, deterministic verifier** before it is trusted (`src/verifiers/`). These
are not LLM judges — they are compute:

| Verifier | What it objectively checks |
|---|---|
| `sqlVerifier` | Runs the SQL in a `READ ONLY` transaction; fails on DB error, **0 rows**, or > `maxRows` (an oversized result usually means a missing filter/join). |
| `insightVerifier` | Every number cited in the insight text must appear (within rounding tolerance) in the actual result rows — cheap anti-hallucination. |
| `planVerifier` | Every column the chart spec references (`x`, `y`, `field`, `dataKey`, …) must exist in the result data. |
| `renderVerifier` | The dashboard HTML must be non-empty, contain a real visualization (`<canvas>`/`<svg>`/`Chart.js`/`<table>`), and every inline `<script>` must **parse** as valid JS (transpiled, not executed). |

A verified failure (`{ok: false, reason}`) is what triggers escalation, and the
`reason` is fed back to the model so it can self-correct. This is the crux: you
only spend a stronger model's tokens when an objective check has *proven* the
cheap output is unusable.

### 1.3 The cache: amortizing SQL generation to ~\$0

`src/cache/` adds an embedding-keyed query cache that turns repeat / near-repeat
questions into near-free operations:

- **Near-exact hit** (cosine similarity ≥ 0.93): the cached SQL is reused
  *verbatim* — one cheap embedding call, no SQL generation at all.
- **Looser paraphrase** (above the lookup threshold, below 0.93): the cached SQL
  skeleton is *adapted* to the new sub-question with a single cheap model call.
- **Miss**: full generation runs, and the successful `(question, embedding, SQL)`
  is written back for next time.

This is what makes the **"smaller scoped tasks"** efficiency so dramatic: once a
sub-question's SQL is cached, the marginal SQL cost for a similar future question
collapses toward zero.

### 1.4 The product surface

`src/web/` serves the comparison page (`comparisonHost.ts`) — both dashboards
side by side with live token/cost/savings counters polled from the ledger. There
is also a polished bee/hive-themed React UI in `ui/` (the `jago-ui` branch) that
visualizes the swarm as bees working a hive, plus a single-model "solo hive" for
contrast.

---

## 2. Testing

Testing is script-driven (`scripts/`, wired as `npm run test:*`). Each script is
a real, runnable checkpoint rather than a mocked unit test, because the thesis is
fundamentally an empirical claim about token usage that only real model calls can
substantiate. Tests skip cleanly when `OPENROUTER_API_KEY` / `DATABASE_URL` are
absent.

| Script | What it validates |
|---|---|
| `test:verifiers` | Each verifier accepts good output and rejects the specific failure modes it guards (0 rows, hallucinated numbers, missing columns, broken JS). Uses an injected fake pool so verifier logic is testable without a live DB. |
| `test:sql-agent` | The SQL agent generates → verifies → retries → escalates within caps and returns verified rows. |
| `test:agents` | Planner, insight, dashboard-plan, codeGen, codeEdit agents each produce schema-valid output. |
| `test:planner-cache` / `test:cache-reuse` | Cache lookup returns hits at the right similarity thresholds; verbatim reuse vs. adapt vs. miss behave correctly. |
| `test:orchestrator` | The full brain lane runs end to end and produces a renderable dashboard. |
| `test:comparison` | **The headline test.** Runs ONE question through *both* lanes, asserts both dashboards render, and asserts the savings number is **real and positive** (read from `getTotals()` per lane). Seeds a throwaway table, runs headless, cleans up. |
| `compare` | The interactive demo: serves the live brain-vs-baseline page against the real imported dataset. |

### What "renderable" means objectively

The comparison test does not eyeball the output. It fetches each lane's served
HTML and asserts it contains the mount point, the Chart.js CDN, the embedded
`window.DASHBOARD_DATA` global, and at least one visualization element. Both lanes
must pass *and* `savingsPct > 0` for the test to be a PASS.

---

## 3. Results

> ⚠️ **Provenance note.** The repository contains the measurement apparatus (a
> real shared ledger, real pricing, real assertions) but does **not** check in a
> frozen results table — numbers come from live runs and will vary with the
> question, the dataset, cache warmth, and model availability. The figures below
> are the *expected envelope* the architecture is designed to hit, derived from
> the configured pricing and the per-stage token profile. Treat them as the
> hypothesis the `test:comparison` / `compare` harness exists to confirm on each
> run, not as a fixed benchmark.

### 3.1 The cost structure that drives the savings

The savings come from the **output-token price gap** between lanes, multiplied by
how few output tokens the brain lane needs per stage:

| Role | Model | Output \$/M |
|---|---|---|
| baseline | `claude-opus-4.8` | **25.0** |
| sqlGen (cheap) | `qwen3-coder-30b` | 0.27 |
| insight | `deepseek-v4-flash` | 0.20 |
| dashboardPlan | `gemini-2.5-flash-lite` | 0.40 |
| codeGen (strong coder) | `qwen3-coder-plus` | 3.3 |

The baseline pays flagship rates on *every* token of a long, single context that
re-derives the schema, runs exploratory SQL, sees all rows, and writes the whole
dashboard in one expensive stream. The brain lane spreads the same work across
short, narrowly-scoped contexts on models that are 8×–90× cheaper per output
token, and only the final dashboard codegen touches a moderately-priced model.

### 3.2 The efficiency gain

For **smaller-scoped tasks** — a focused question, or one whose sub-questions hit
a warm cache — the brain lane is expected to need on the order of **5–10% of the
tokens (and an even smaller fraction of the cost)** of the single strong-model
baseline to reach an equivalent rendered dashboard. The drivers:

1. **Scope shrinks tokens.** A sub-question like "revenue by region" carries a
   tiny prompt and emits a tiny SQL string. The baseline carries the full
   question, full schema, all intermediate tool results, and the entire dashboard
   in one context — far more tokens overall.
2. **Cheap models price those tokens at a fraction** of the flagship rate.
3. **The cache removes SQL generation entirely** on repeat/near-repeat
   sub-questions (verbatim reuse ≈ one embedding ≈ ~\$0).
4. **Verifiers prevent wasted escalation** — strong-model tokens are spent only on
   *proven* failures, not defensively.

The cost gap is wider than the token gap, because the brain lane's tokens are
priced cheaply while the baseline's are priced at flagship rates — the
`savingsPct` shown on the comparison page is computed on **cost**, not raw tokens.

### 3.3 Where the gain narrows

The advantage is largest for smaller, cache-friendly, decomposable questions and
narrows when:

- the question genuinely requires **multi-step data threading** (the DAG passes
  ordering, not data, between sub-questions);
- decomposition fails and the **whole-question fallback** fires, which escalates
  SQL to the flagship as a last resort;
- the **cache is cold** and every sub-question pays full (cheap) generation.

Even cold, the brain lane retains a large cost advantage because its work is
priced at cheap-model rates; the cache is what pushes a small task down into the
5–10% band.

---

## 4. Next steps

1. **Freeze a benchmark suite.** Commit a fixed set of questions (small / medium /
   large scope) and a results table from `test:comparison` so the 5–10% claim is
   reproducible and tracked over time rather than re-derived per run.
2. **Quality parity, not just render parity.** Today both lanes must *render*; add
   an objective answer-equivalence check (e.g. compare the underlying result sets
   / KPIs the two dashboards encode) so savings can never come at the cost of a
   worse answer.
3. **Optional data threading in the DAG.** For the multi-step questions where the
   gain narrows, let a dependent sub-question receive its dependency's *results*
   as context — gated behind a flag so the parallel/simple default stays.
4. **Cache hit-rate telemetry.** Surface verbatim-vs-adapt-vs-miss rates and their
   token impact on the comparison page; the cache is the single biggest lever on
   the headline number and is currently under-instrumented.
5. **Escalation analytics.** Log how often each cheap role escalates and on which
   verified-failure reason, to tune the cheap/escalation model choices in
   `config/models.ts` against real failure data.
6. **Broaden datasets.** The thesis claims domain-agnosticism; validate it by
   running the suite against several unrelated schemas, not just Olist.
7. **Robustness on the baseline cap.** Confirm the 8-iteration baseline cap is a
   fair fight — too low and the comparison flatters the brain lane; too high and
   it inflates baseline cost. Pick it from data.

---

## Appendix: file map

| Area | Path |
|---|---|
| Model config (single source of truth) | `config/models.ts` |
| Shared model client + ledger | `src/models/` |
| Schema introspection / scoped context | `src/db/`, `src/context/` |
| Cheap sub-agents | `src/agents/` |
| Objective verifiers | `src/verifiers/` |
| Brain orchestrator | `src/orchestrator/` |
| Strong-model baseline | `src/baseline/` |
| Embedding query cache | `src/cache/` |
| Comparison + dashboard hosts | `src/web/` |
| Bee/hive React UI | `ui/` |
| Test / demo scripts | `scripts/` (`npm run test:*`, `npm run compare`) |
</content>
</invoke>
