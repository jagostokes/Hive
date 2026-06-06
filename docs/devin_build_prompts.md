# Devin Build Plan — Brain-Pattern Data→Dashboard

A cheap-first / verify / escalate swarm that turns a natural-language data question into a working local dashboard, alongside a single-strong-model baseline, with a live token + cost comparison.

## How to use this
- Paste each prompt into Devin **in order**. Wait for it to finish and **checkpoint** before sending the next.
- Prompts marked ⚠️ are the *novel core* (planner DAG, fan-out/escalate control flow, coalesce). Read Devin's output on these closely — these are the parts you're judged on and the parts an autonomous agent most easily gets plausibly-wrong.
- Before Prompt 4, run `GET /api/ai/models` and paste the real model slugs into the config from Prompt 2. The slugs below are best-guesses from the OpenRouter catalog and may differ.

## Standing constraints (these apply to every prompt)
- **Domain-agnostic.** Never hardcode table names, column names, or domain assumptions. Read the live schema at runtime. The natural-language question is an input, not a constant.
- **One model client.** Every LLM call goes through the single wrapper from Prompt 2 so token/cost accounting is automatic. No direct `fetch` to OpenRouter anywhere else.
- **Models live in config**, never inline. Swapping a model = editing one file.
- **Capped loops.** Every agent: max 2 cheap attempts, then 1 escalation, then stop gracefully. No uncapped retries.
- **Per-agent system prompts.** Each agent has its own dedicated system prompt defining its single role, sent as the system message — separate from the injected context, which goes in the user message. No shared system prompt across agents.
- **Role-scoped context.** Never hand the full schema+glossary blob to every agent. Each agent receives only the scoped slice from the context provider (Prompt 1). Context shrinks down the pipeline; the insight, dashboard, and code agents get no schema or glossary at all.
- **Credentials.** Use the InsForge cloud-managed OpenRouter key (read `OPENROUTER_API_KEY` from env). Do **not** set a BYOK key, and do not paste keys into chat — set them as environment/secret values only.
- **Stack.** Local Node + TypeScript orchestrator. InsForge Postgres holds the data, glossary, and cache. OpenRouter (OpenAI SDK, `baseURL: https://openrouter.ai/api/v1`) serves models. Dashboard renders on localhost.

---

## Prompt 0 — Project brief & conventions
```
Project: a "brain-pattern" system that answers a natural-language data question by decomposing it into specialized sub-agents, each running on a cheap model whose output is checked by an objective verifier, escalating to a stronger model only on verified failure. It produces a working dashboard on localhost. In parallel, a single strong model performs the same task end-to-end as a baseline. We compare total tokens and cost.

Hard requirements for the whole project:
- TypeScript + Node. Local orchestrator. InsForge Postgres for data. OpenRouter (OpenAI SDK, baseURL https://openrouter.ai/api/v1, key from env OPENROUTER_API_KEY) for all model calls.
- Fully domain-agnostic: never hardcode table/column names or domain logic. The schema is discovered at runtime; the question is an input.
- All model calls go through one shared client; models are defined in one config file; all retry/escalate loops are capped (2 cheap + 1 escalation, then stop).

Set up the repo structure now: /src with subfolders for db, models, agents, verifiers, orchestrator, baseline, web; a config folder; a .env.example listing OPENROUTER_API_KEY and the InsForge connection vars; a README stub describing the architecture above. Do not implement logic yet — just the structure, package.json, tsconfig, and a `npm run dev` script placeholder. Confirm the tree when done.
```
*Checkpoint:* repo tree exists, builds, no logic.

---

## Prompt 1 — Domain-agnostic backend foundation
```
Create three Postgres tables on InsForge if they don't exist, with GENERIC structure (no domain assumptions):
- A query cache table: id, question_text, question_embedding (pgvector), generated_sql, was_successful (bool), created_at.
- A business glossary table: id, term, definition, sql_expression (nullable).
- Do NOT create domain tables — those get seeded separately and vary by demo. Assume one or more unknown domain tables already exist.

Then build two runtime utilities:
1. A schema introspector that queries information_schema to return all user tables, their columns, and types as a compact JSON description. It must work for ANY schema it finds — no hardcoded names.
2. A context provider that FETCHES the ground truth ONCE per run and caches it in memory (the introspected schema + all glossary rows), then exposes ROLE-SCOPED accessors that each return only the slice one agent needs. It must NOT return a single shared block for everyone. Keep it pure data assembly — NO model call anywhere in here. Accessors:
   - forPlanner() -> full schema + full glossary
   - forSql(subQuestion) -> the relevant tables (or the whole schema if it's small) + only the glossary rows that have an sql_expression
   - forInsight(resultRows) -> a compact column dictionary for the returned data + any single metric definition in play; NO DDL, NO full glossary
   - forDashboardPlan(resultRows) -> the result's columns + a few sample rows; nothing about the source schema
   - forCodeGen(plan, data) -> the chart plan + the data only
   - forCodeEdit(component, error) -> the component + the render error only
The context deliberately shrinks down the pipeline, and the last three accessors carry no schema or glossary at all — that minimization is a load-bearing reason the cheap models stay accurate, not just a cost trick. Fetch once and share the cached raw data internally; scope only at the accessor boundary.

Write a small script that prints what EACH accessor returns for a dummy question/rows so I can eyeball that each role gets only its slice.
```
*Checkpoint:* run the print script; confirm each accessor returns only its scoped slice (planner and SQL see schema/glossary, insight/dashboard/code see none) with zero hardcoded names, and that the underlying fetch happens once.

---

## Prompt 2 — Model client + token/cost accounting
```
Build the single shared model client every agent will use. Requirements:
- Wraps the OpenAI SDK pointed at OpenRouter (baseURL https://openrouter.ai/api/v1, key from env).
- One function: callModel({ role, model, messages, temperature?, maxTokens?, tools? }) -> { text, usage }.
- Reads the `usage` object off every response (prompt_tokens, completion_tokens) and records it.
- Maintains a per-run accounting ledger: every call appends { role, model, promptTokens, completionTokens, costUsd }, where cost is computed from a pricing map (USD per million input/output tokens) defined in config. Expose getLedger() and getTotals().
- A `lane` tag on each call so we can group ledger entries by "brain" vs "baseline" later.

Create config/models.ts as the SINGLE source of model choices and prices. Pre-fill with these roles (slugs to be verified against GET /api/ai/models; prices per million in/out from the catalog):
  embedding:       openai/text-embedding-3-small         (0.02 / -)
  planner:         deepseek/deepseek-v4-pro               (0.43 / 0.87)
  sqlGen:          qwen/qwen3-coder-30b-a3b-instruct      (0.07 / 0.27)
  sqlEscalation:   qwen/qwen3-coder-plus                  (0.65 / 3.3)
  insight:         deepseek/deepseek-v4-flash             (0.10 / 0.20)
  dashboardPlan:   google/gemini-2.5-flash-lite           (0.10 / 0.40)
  codeGen:         qwen/qwen3-coder-flash                 (0.20 / 0.97)
  codeEdit:        relace/relace-apply-3                  (0.85 / 1.3)
  baseline:        anthropic/claude-opus-4.8              (5.0 / 25.0)

Write a smoke test that makes one cheap call, prints the text, and prints the ledger entry with computed cost.
```
*Checkpoint:* smoke test returns text and a correct cost number. This client is the source of truth for the whole demo — confirm the math.

---

## Prompt 3 — The verifiers (objective oracles)
```
Build verifiers as PURE functions (no model calls). Each returns { ok: boolean, reason?: string } so agents can self-correct on the reason.
1. sqlVerifier(sql, db): executes the SQL read-only; ok=false if it errors, returns 0 rows, or returns an implausibly large row count (cap configurable). On error, reason = the DB error message.
2. insightVerifier(insightText, resultRows): ok=false if the insight cites any number not present in resultRows (cheap anti-hallucination check). Be lenient on rounding.
3. planVerifier(dashboardPlan, resultSchema): ok=false if the plan references any column/field not present in the result data.
4. renderVerifier(componentCode): ok=false if the code fails to build/render (attempt a headless compile/render; reason = the build error).
Add unit-ish tests for each with one passing and one failing example.
```
*Checkpoint:* all four verifiers reject the bad example and accept the good one. Build these correctly before any agent — the agents are defined by them.

---

## Prompt 4 — SQL sub-agent (the template pattern) ⚠️
```
Build the SQL sub-agent. This is the TEMPLATE every other agent follows, so make the shape clean and reusable.
Flow:
1. Compose messages as a dedicated SYSTEM prompt for THIS agent only ("You write a single read-only SQL query for the given question using ONLY the provided schema and glossary. Return SQL only."), followed by a USER message containing this agent's scoped context from contextProvider.forSql(subQuestion) — the relevant tables + the sql_expression glossary rows — plus the sub-question. Do not pass the full context block; only the SQL slice.
2. Call the cheap model (role: sqlGen) via the shared client (lane: "brain").
3. Run sqlVerifier. If ok, return { sql, rows }.
4. If not ok: feed the failure reason back and retry ONCE on the same cheap model.
5. Still failing: escalate ONCE to the sqlEscalation model, same verify.
6. Still failing: return a graceful failure object. Never loop further.
Return the full attempt trail (models used, attempts) for observability.
Test it against a seeded dummy table with one answerable and one deliberately ambiguous question.
```
*Checkpoint:* watch the attempt trail — confirm it actually escalates on failure and HARD-STOPS after the cap. This control flow is core; don't trust it until you've seen it escalate and stop.

---

## Prompt 5 — Remaining sub-agents (same template)
```
Using the SQL agent as the template (own SYSTEM prompt -> scoped context in the USER message -> cheap model -> verify -> retry once -> escalate once -> stop), build the rest. Each agent gets its OWN dedicated system prompt (single role) and ONLY its scoped context from the provider — note the last three carry no schema or glossary:
- insightAgent: system = "Extract 2-3 factual insights from the given data; cite only numbers present in it." context = forInsight(resultRows). verified by insightVerifier.
- dashboardPlanAgent: system = "Given result data, output a JSON chart spec (type, x, y, title) using only columns present in the data." context = forDashboardPlan(resultRows). verified by planVerifier.
- codeGenAgent: system = "Given a chart spec and data, output one self-contained React component. Code only." context = forCodeGen(plan, data). verified by renderVerifier.
- codeEditAgent: system = "Given a broken component and its render error, return the fixed component. Code only." (uses the codeEdit fast-apply model). context = forCodeEdit(component, error). verified by renderVerifier. Only invoked when codeGen's output fails to render.
Each agent uses its configured model and tags lane:"brain". Keep every system prompt tight and single-purpose; do NOT share one system prompt across agents, and do NOT pass any agent more context than its accessor returns.
```
*Checkpoint:* each agent runs standalone on dummy data and its verifier gates it.

---

## Prompt 6 — Planner + semantic cache lookup ⚠️
```
Build the planner and the cache.
Cache lookup (run first): embed the incoming question (embedding model), cosine-search the query cache table (pgvector) for a near match above a threshold. On hit, return the cached SQL to be reused/adapted, skipping fresh SQL generation. On miss, proceed.
Planner: call the planner model with its own system prompt + the question + contextProvider.forPlanner() (full schema + full glossary). It must return JSON: a list of sub-questions, each marked with its dependencies (which other sub-questions must finish first). Independent sub-questions = parallelizable; dependent ones = ordered. Validate the JSON shape; if invalid, retry once then fail gracefully.
Output a structured plan object: an ordered DAG of sub-questions with parallel groups identified.
Test with a multi-part question ("show me A, B, and the trend of C") and confirm A/B/C come back as independent parallel sub-questions.
```
*Checkpoint:* ⚠️ This is the heart of the parallelism story. Verify the DAG actually separates independent sub-questions into a parallel group, and that a near-duplicate question hits the cache. Read this code yourself.

---

## Prompt 7 — Orchestrator: fan-out → lanes → coalesce → render ⚠️
```
Build the orchestrator that runs the brain lane end to end:
1. Cache lookup, then planner -> plan DAG.
2. For each parallel group, run a full lane PER sub-question CONCURRENTLY (Promise.all). A lane = SQL agent -> insight agent -> dashboard-plan agent. Respect DAG ordering for dependent sub-questions.
3. On a successful, non-cached SQL result, write the question+embedding+SQL to the cache table.
4. Coalesce: merge all sub-question dashboard plans into ONE combined dashboard spec.
5. codeGen the combined dashboard -> renderVerifier -> codeEdit if needed.
6. Serve the rendered dashboard on localhost and return the full ledger for this run (lane:"brain").
Make concurrency real (parallel groups run at once), and keep all caps intact.
```
*Checkpoint:* ⚠️ Confirm parallel lanes actually run concurrently (log timestamps), the dashboard renders on localhost, and the brain ledger total looks sane. This is the demo's left half.

---

## Prompt 8 — Baseline lane + side-by-side comparison host
```
Build the baseline and the comparison UI.
Baseline lane: a single call-loop to the `baseline` strong model that does the WHOLE task in one agent loop — it can run SQL (give it the same execute-SQL tool), see results, and write the same React dashboard — producing the SAME artifact (a working localhost dashboard) from the SAME question against the SAME database. Tag all its calls lane:"baseline". No decomposition, no cheap models.
Comparison host: a localhost page that, given a question, runs both lanes and shows side by side:
- both rendered dashboards,
- live token counters (input/output) per lane updating as calls complete,
- total cost per lane and the % savings,
- a small log of which models each lane used.
Make the counters read from getTotals() per lane so the numbers are real, not mocked.
```
*Checkpoint:* run one question through both; confirm both dashboards render and the savings number is real and large. This is the whole pitch on one screen.

---

## Prompt 9 — Stretch: cache pre-seed + SQL-skeleton reuse
```
(Only if time remains.) Add a seed script that pre-populates the query cache with ~10-15 known-good question->SQL pairs (embeddings included) for the current demo schema, so demo questions resolve instantly and reliably. Improve cache reuse so a near-match adapts the cached SQL (swap filters/columns) via a single cheap model call instead of full regeneration. Show cache hits as near-zero-cost entries in the comparison counter.
```
*Checkpoint:* a pre-seeded question returns near-instant at near-zero cost in the comparison view.
