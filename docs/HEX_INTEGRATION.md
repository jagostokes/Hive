# Hive ↔ Hex integration

Hex is the hosted notebook/BI surface; Hive is the self-improving agent engine.
Both point at the same data. There are two "wires":

1. **Hex → databases** (SQL cells): read the analytics data (ClickHouse) and
   Hive's own brain-state (Neon).
2. **Hex → Hive API** (Python cell): drive Hive live and show its answers.

## Data connections to create in Hex

Both are **PostgreSQL** connections (ClickHouse Cloud exposes a Postgres wire
protocol, so Hex's Postgres connector works for it too).

### Connection A — `clickhouse-data` (the analytics dataset)
| Field | Value |
|-------|-------|
| Host | `my-first-postgres-service-88dba629.pgf7jjw933xy5mqa27x6nkwzqy.c0.us-east-1.aws.pg.clickhouse.cloud` |
| Port | `5432` |
| Database | `postgres` |
| User | `postgres` |
| Password | *(the password set on the ClickHouse Postgres service)* |
| SSL | require |

> ClickHouse Cloud may IP-allowlist Postgres connections. If Hex times out,
> allowlist Hex's egress IPs (or allow-all) in the ClickHouse Cloud console.

### Connection B — `hive-brain` (Hive's learning state, on Neon)
| Field | Value |
|-------|-------|
| Host / Port / DB / User / Password | *(from Neon `DATABASE_URL`)* |
| SSL | require |

---

## Level 1 — show the ClickHouse data (SQL cells on `clickhouse-data`)

```sql
-- Revenue by category
select c.category_name,
       round(sum(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) as revenue
from order_details od
join products p   on p.product_id  = od.product_id
join categories c on c.category_id = p.category_id
group by c.category_name
order by revenue desc;
```

```sql
-- Monthly revenue trend
select date_trunc('month', o.order_date) as month,
       round(sum(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) as revenue
from orders o
join order_details od on od.order_id = o.order_id
group by 1 order by 1;
```

Drop a bar chart on the first, a line chart on the second.

---

## Level 2 — Hive's brain dashboard (SQL cells on `hive-brain`)

Each cell below is ready to paste. Suggested visualization noted per cell.

> **Prompt evolution is driven by a review agent.** During training a
> heftier-model critic (LLM-as-judge) grades every query the objective verifier
> accepted. When a query "runs" but answers the question poorly (review_score
> below the surgery threshold), it triggers a prompt surgery — so the sqlGen
> system prompt rewrites itself on *quality*, not just on hard failures. The
> `prompt_evolution`, `training_trajectory`, and `review_quality` cells below
> visualize this loop.

```sql
-- [cell: prompt_evolution]  TABLE — how the sqlGen system prompt rewrote itself
select role, generation, diagnosis,
       round((win_rate*100)::numeric,1) as win_rate_pct, created_at
from prompt_versions
order by role, generation;
```

```sql
-- [cell: training_trajectory]  LINE — per-question results of the latest run
select question_index, style, total_tokens, cost_usd,
       sql_success, first_attempt_pass, escalation_used, attempts,
       prompt_generation, review_score
from training_metrics
where run_id = (select id from training_runs order by started_at desc limit 1)
order by question_index;
```

```sql
-- [cell: review_quality]  LINE — reviewer score per question + the prompt
-- generation active at the time. Dips below 0.8 are what trigger surgery; the
-- generation should step up right after a dip and scores recover after.
select question_index, review_score, prompt_generation
from training_metrics
where run_id = (select id from training_runs order by started_at desc limit 1)
  and review_score is not null
order by question_index;
```

```sql
-- [cell: rolling_curves]  LINE — tokens trend down, first-attempt rate trends up
select question_index,
       round(avg(total_tokens) over (order by question_index
             rows between 4 preceding and current row), 0) as rolling_avg_tokens,
       round(avg(case when first_attempt_pass then 1.0 else 0.0 end) over (
             order by question_index rows between 4 preceding and current row), 3)
             as rolling_first_attempt_rate
from training_metrics
where run_id = (select id from training_runs order by started_at desc limit 1)
order by question_index;
```

```sql
-- [cell: run_summary]  KPI cards — headline metrics for the latest run
select dataset, questions_run,
       round((success_rate*100)::numeric,1)        as success_pct,
       round((first_attempt_rate*100)::numeric,1)  as first_attempt_pct,
       round((escalation_rate*100)::numeric,1)     as escalation_pct,
       total_tokens, total_cost_usd, prompt_surgeries, review_surgeries,
       glossary_terms_added, learned_examples_stored
from training_runs order by started_at desc limit 1;
```

```sql
-- [cell: glossary_growth]  AREA — cumulative business terms it researched itself
select created_at, term, source,
       count(*) over (order by created_at) as cumulative_terms
from business_glossary order by created_at;
```

```sql
-- [cell: cache]  KPI — semantic cache size + success
select count(*) as total_cached,
       count(*) filter (where was_successful) as successful_cached
from query_cache;
```

```sql
-- [cell: synthesized_verifiers]  TABLE — the tests Hive wrote for itself
select stage, name, failure_class, active, validated, fire_count, pass_count
from synthesized_verifiers order by created_at;
```

```sql
-- [cell: learned_examples]  TABLE — escalation corrections fed back as few-shot
select role, sub_question, created_at from learned_examples order by created_at;
```

---

## Level 3 — drive Hive live from Hex (Python cell)

Hive's API must be reachable from Hex's cloud. Expose the local server with a
tunnel:

```bash
npm run ui:server                       # starts the API on :4317
cloudflared tunnel --url http://localhost:4317   # prints a public https URL
```

Add a Hex **text input** parameter named `question` (and optionally a boolean
`run_baseline`). Then a Python cell:

```python
import requests, pandas as pd
from IPython.display import HTML

HIVE_URL = "https://YOUR-TUNNEL.trycloudflare.com"   # from cloudflared

resp = requests.post(
    f"{HIVE_URL}/api/ask",
    json={"question": question, "baseline": bool(run_baseline)},
    timeout=600,
)
resp.raise_for_status()
result = resp.json()

print(f"prompt edition: Gen {result['promptGeneration']}   "
      f"cache hits: {result['cacheHits']}   "
      f"brain cost: ${result['brain']['costUsd']:.4f}")
if "baseline" in result:
    print(f"baseline cost: ${result['baseline']['costUsd']:.4f}   "
          f"savings: {result['savingsPct']}%")

# Generated SQL + insight per sub-question
sql_df = pd.DataFrame([
    {"sub_question": c["question"], "sql": c["sql"],
     "insight": c["insight"], "rows": len(c["rows"])}
    for c in result["brain"]["charts"]
])
sql_df
```

Render Hive's dashboard inline in a second cell:

```python
HTML(result["brain"]["dashboardHtml"] or "<p>no dashboard produced</p>")
```

### `/api/ask` response shape
```jsonc
{
  "question": "...",
  "ok": true,
  "promptGeneration": 3,
  "cacheHits": 1,
  "brain": {
    "ok": true,
    "costUsd": 0.0048,
    "tokens": 5123,
    "charts": [{ "question": "...", "sql": "...", "insight": "...", "rows": [...] }],
    "dashboardHtml": "<div>...</div>"
  },
  "baseline": {                 // only when {"baseline": true}
    "ok": true, "costUsd": 0.051, "tokens": 8210, "dashboardHtml": "..."
  },
  "savingsPct": 90.6            // only when baseline ran
}
```

Baseline is opt-in because it fires the expensive flagship model. Leave it off
for cheap interactive use; turn it on for the cost-comparison demo.
