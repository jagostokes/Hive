# Hive

A **brain-pattern** system that answers a natural-language data question by
decomposing it into specialized sub-agents, each running on a cheap model whose
output is checked by an objective verifier, escalating to a stronger model only
on **verified** failure. It produces a working dashboard on `localhost`. In
parallel, a single strong model performs the same task end-to-end as a baseline.
We compare total tokens and cost.

> Status: **scaffold only** — structure in place, no logic implemented yet.

## Architecture

```
question ─┬─► orchestrator ─► decompose ─► sub-agents (cheap model)
          │                        │            │
          │                        │            ▼
          │                        │        verifier (objective check)
          │                        │            │ verified failure
          │                        │            ▼
          │                        └────► escalate (strong model)
          │                                     │
          │                                     ▼
          │                              assembled answer ─► web dashboard
          │
          └─► baseline (single strong model, end-to-end)
                                                 │
                          token + cost comparison ◄──┘
```

### Loop caps
Every retry/escalate loop is capped: **2 cheap attempts + 1 escalation, then stop.**

### DAG dependency behavior
The planner decomposes questions into a directed acyclic graph (DAG) of sub-questions. **Dependencies enforce temporal ordering, not data flow.** This means:

- Dependent sub-questions run after their dependencies complete
- However, dependent sub-questions do **not** receive their dependency's result data as context
- Each sub-question generates SQL from the schema independently

**Rationale**: This design prioritizes parallelism and simplicity. Most analytical questions can be answered by independent queries against the same schema. Data threading would add complexity (context injection, result serialization) and is only needed for multi-step workflows where later steps truly require intermediate results.

**When this matters**: If you need a sub-question to filter/process its dependency's actual results (e.g., "analyze the outliers from the previous trend"), this would require extending the lane to pass result data between dependent sub-questions.

## Hard requirements
- **TypeScript + Node**, local orchestrator.
- **InsForge Postgres** as the data source.
- **OpenRouter** for all model calls (OpenAI SDK, baseURL `https://openrouter.ai/api/v1`, key from `OPENROUTER_API_KEY`).
- **Fully domain-agnostic**: no hardcoded table/column names or domain logic. The schema is discovered at runtime; the question is an input.
- **One shared model client**; models defined in **one config file** (`config/`); all loops capped (2 cheap + 1 escalation).

## Structure
```
src/
  db/            connect to InsForge Postgres; discover schema at runtime
  models/        single shared model client (OpenAI SDK → OpenRouter)
  agents/        specialized sub-agents (cheap model by default)
  verifiers/     objective checks; verified failure triggers escalation
  orchestrator/  decompose + capped retry/escalate loop + assemble
  baseline/      single strong model, end-to-end, for comparison
  web/           localhost dashboard (answer + token/cost comparison)
config/          model definitions and loop caps (single source of truth)
.env.example     OPENROUTER_API_KEY + InsForge connection vars
```

## Authors

Built by **Jago Stokes** and **Ben Guettler**.

## Setup
```bash
npm install
cp .env.example .env   # fill in OPENROUTER_API_KEY + InsForge connection vars
npm run dev            # placeholder for now
```
