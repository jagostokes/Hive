-- Generic, domain-agnostic infrastructure tables for Hive.
-- Idempotent: safe to run repeatedly. No domain tables here — those are seeded
-- separately per demo and vary.

create extension if not exists vector;

-- Cache of natural-language questions -> generated SQL, with an embedding of the
-- question for similarity lookup. vector(1536) matches openai/text-embedding-3-small.
create table if not exists query_cache (
  id                 bigserial primary key,
  question_text      text not null,
  question_embedding vector(1536),
  generated_sql      text,
  was_successful     boolean,
  created_at         timestamptz default now()
);

-- Business glossary: human terms -> definitions, optionally backed by a SQL
-- expression the SQL agent can reuse. Rows can be seeded manually or grown
-- automatically by the glossary-growth researcher agent.
create table if not exists business_glossary (
  id             bigserial primary key,
  term           text not null,
  definition     text not null,
  sql_expression text,
  source         text default 'seed',       -- 'seed' | 'auto-research'
  created_at     timestamptz default now()
);

-- Prompt surgery: versioned system prompts per agent role. The surgeon agent
-- rewrites a failing prompt and persists the new version here. The orchestrator
-- loads the latest (highest generation) version for each role at run start.
create table if not exists prompt_versions (
  id          bigserial primary key,
  role        text not null,                 -- matches ModelRole (e.g. 'sqlGen')
  generation  integer not null default 1,    -- monotonically increasing
  system_prompt text not null,               -- the full system-message text
  parent_id   bigint references prompt_versions(id),  -- previous version
  diagnosis   text,                          -- why the surgeon rewrote it
  win_rate    real,                          -- rolling success rate (0..1)
  created_at  timestamptz default now()
);

-- Learned examples: when a cheap agent fails and the escalation model succeeds,
-- the (question, bad_output, good_output) triple is stored here. On future runs,
-- relevant examples are injected as few-shot into the cheap agent's prompt so it
-- learns from the expensive model's corrections.
create table if not exists learned_examples (
  id            bigserial primary key,
  role          text not null,               -- which agent role
  sub_question  text not null,               -- the input that caused the failure
  bad_output    text not null,               -- the cheap model's rejected output
  good_output   text not null,               -- the escalation model's accepted output
  created_at    timestamptz default now()
);

-- Training runs: each training session is persisted here with summary metrics.
-- Per-question metrics are stored in training_metrics, linked by run_id.
create table if not exists training_runs (
  id              bigserial primary key,
  started_at      timestamptz not null,
  finished_at     timestamptz,
  dataset         text not null default 'northwind',
  questions_total integer not null,
  questions_run   integer default 0,
  success_rate    real,
  first_attempt_rate real,
  escalation_rate real,
  total_tokens    bigint default 0,
  total_cost_usd  real default 0,
  prompt_surgeries integer default 0,
  glossary_terms_added integer default 0,
  learned_examples_stored integer default 0,
  review_surgeries integer default 0   -- surgeries triggered by the review agent
);

-- Training metrics: per-question results within a training run.
create table if not exists training_metrics (
  id                bigserial primary key,
  run_id            bigint references training_runs(id),
  question_index    integer not null,
  question_text     text not null,
  style             text,
  total_tokens      integer not null,
  cost_usd          real not null,
  sql_success       boolean not null,
  first_attempt_pass boolean not null,
  escalation_used   boolean not null,
  attempts          integer not null,
  prompt_generation integer,           -- which prompt gen was active
  failure_reason    text,
  review_score      real,               -- reviewer quality score (0..1), null if not reviewed
  elapsed_ms        integer,
  created_at        timestamptz default now()
);

-- Synthesized verifiers (verifier genesis / recursive testing): when an existing
-- verifier misses a failure, a meta-agent writes a new JS predicate function and
-- stores it here. Active predicates run alongside the built-in verifiers on
-- every future check. The system literally grows new tests for itself.
create table if not exists synthesized_verifiers (
  id             bigserial primary key,
  stage          text not null,              -- 'sql' | 'insight' | 'plan' | 'render'
  name           text not null,              -- human-readable check name
  failure_class  text not null,              -- what class of failure it catches
  predicate_code text not null,              -- JS function body
  validated      boolean default false,      -- passed dry-run against known failure?
  active         boolean default false,      -- run on every future check?
  fire_count     bigint default 0,           -- times it caught a failure
  pass_count     bigint default 0,           -- times it ran without firing
  created_at     timestamptz default now()
);
