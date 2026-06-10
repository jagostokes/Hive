---
description: Hive project conventions for coding agents
globs: *
alwaysApply: true
---

# Hive — Agent Guidelines

## What is Hive?

A brain-pattern data-question system. It decomposes natural-language questions into
specialized sub-agents running on cheap models, verified objectively, escalating to
a stronger model only on verified failure. A baseline single-model lane runs in
parallel for cost comparison. Results render as a localhost dashboard.

## Backend

- **Postgres** via [Neon](https://neon.tech) (free tier, pgvector enabled).
- Connection: raw `pg` Pool (`src/db/client.ts`), reads `DATABASE_URL` from `.env`.
- Schema: `src/db/schema.sql` — run `npm run db:setup` to apply.
- No ORM; all queries are raw SQL.

## Model calls

- **OpenRouter** (OpenAI SDK, `baseURL: https://openrouter.ai/api/v1`).
- Every call goes through `callModel()` in `src/models/index.ts`.
- Models defined in `config/models.ts` — single source of truth.
- Never hardcode a model slug outside `config/models.ts`.

## Key conventions

- **Domain-agnostic**: never hardcode table/column names. Schema discovered at runtime.
- **Capped loops**: 2 cheap attempts + 1 escalation, then stop (`LOOP_CAPS`).
- **Role-scoped context**: each agent gets only its slice from the context provider.
- **Credentials**: read from env vars. Never hardcode or commit keys.
