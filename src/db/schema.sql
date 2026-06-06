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
-- expression the SQL agent can reuse.
create table if not exists business_glossary (
  id             bigserial primary key,
  term           text not null,
  definition     text not null,
  sql_expression text
);
