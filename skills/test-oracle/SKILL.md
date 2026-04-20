---
name: test-oracle
description: |
  Answer plain-language questions about the testing data domain.
  Routes questions to a fixed parameterized SQL query library — no LLM-generated SQL.
  Supports --project, --strategy, --since, --status filters.

  Use when: "what scenarios exist", "last verdict", "show failed runs",
  "what tests passed", "oracle", "query test data", "test history",
  "what tasks are open", "show bootstrap verdict",
  "/wicked-testing:oracle"
---

# Test Oracle Skill

Answer plain-language questions about your testing history. The oracle routes your question to a library of 12 fixed parameterized SQL queries — no LLM-generated SQL, no ad-hoc queries, no SQL injection vectors.

## v1 Uses Fixed Parameterized SQL

The oracle in v1 maps questions to named queries by keyword matching. Every query is:
- **Fixed at build time** — in `lib/oracle-queries.mjs`
- **Parameterized** — never uses string interpolation in SQL
- **Auditable** — readable as code, no hidden logic
- **Read-only** — no writes, no DELETE, no DROP

If your question doesn't match any template, the oracle returns a list of supported question patterns — it never crashes or generates ad-hoc SQL.

## Supported Questions (v1)

| Query | Example Question |
|-------|-----------------|
| `scenarios_for_project` | "What scenarios exist for the auth-service project?" |
| `last_verdict_for_scenario` | "What was the last verdict for the login scenario?" |
| `runs_by_status` | "What runs have status failed?" |
| `failed_runs_since` | "What failed since 2026-01-01?" |
| `tasks_by_status` | "What tasks are in progress?" |
| `tasks_for_project` | "What tasks exist for project X?" |
| `current_strategy_for_project` | "What is the strategy for the checkout project?" |
| `recent_runs` | "Show the last 10 runs" |
| `verdicts_since` | "What verdicts were issued since last week?" |
| `row_counts` | "How many rows are in each table?" |
| `schema_version` | "What schema version is the database?" |
| `most_recent_project` | "Which project was updated most recently?" |

## Command

```
/wicked-testing:oracle "<question>" [--project <name>] [--status <status>] [--since <date>] [--json]
```

- `question` — natural-language question about your test data
- `--project <name>` — filter results to this project
- `--status <status>` — filter by status (passed, failed, running, open, in_progress, done, blocked)
- `--since <date>` — filter to records after this ISO date (e.g. 2026-01-01)
- `--json` — emit JSON envelope

## Instructions

### 1. Parse Question and Filters

Extract the question string and any filter flags (`--project`, `--status`, `--since`).

### 2. Check SQLite Availability

If better-sqlite3 is not available, return `ERR_SQLITE_UNAVAILABLE`:

```bash
python3 -c "import json,sys; sys.stdout.write(json.dumps({'ok': False, 'error': 'SQLite unavailable — oracle requires database index. Run /wicked-testing:setup to repair.', 'code': 'ERR_SQLITE_UNAVAILABLE', 'meta': {'command': 'wicked-testing:oracle', 'store_mode': 'json-only'}}))" 2>/dev/null || python -c "..."
```

### 3. Route Question to Named Query

Use `lib/oracle-queries.mjs` `routeQuestion()` to map the question to a named query:

```javascript
import { routeQuestion, buildOracleQuery, supportedPatterns } from './lib/oracle-queries.mjs';

const queryName = routeQuestion(question, { project, status, since });
if (!queryName) {
  return `No matching query template in v1. Supported question patterns:\n${supportedPatterns()}`;
}
```

### 4. Execute the Query

Use `buildOracleQuery()` to get the SQL and params, then run via better-sqlite3:

```javascript
import Database from 'better-sqlite3';
const db = new Database('.wicked-testing/wicked-testing.db');
const { sql, params } = buildOracleQuery(queryName, { project, status, since, limit: 10 });
const rows = db.prepare(sql).all(...params);
```

**Important**: The oracle is read-only. It never calls `DomainStore.create/update/delete`. It accesses SQLite directly through the prepared statement library.

### 5. Format the Response

**Without `--json`** — Return a markdown table or list:

For rows returned:
```markdown
## Oracle: {question}

**Query**: {queryName}
**Filters**: {applied filters or "none"}
**Results**: {N} rows

| Column 1 | Column 2 | ... |
|----------|----------|-----|
| {value} | {value} | ... |
```

For no rows:
```markdown
## Oracle: {question}

No data found. The store may be empty or the filter may not match any records.
Run /wicked-testing:stats to check data availability.
```

**With `--json`** — Use `scripts/_python.sh` Python pattern for the JSON envelope:

```bash
python3 -c "import json,sys; sys.stdout.write(json.dumps({'ok': True, 'data': {'query': queryName, 'rows': [...], 'count': N}, 'meta': {'command': 'wicked-testing:oracle', 'duration_ms': 0, 'store_mode': 'sqlite+json'}}))" 2>/dev/null || python -c "..."
```

### 6. Handle No Match

If no query template matches, return a helpful message — not an error:

```markdown
## Oracle: No Matching Query

Your question didn't match any v1 query template.

Supported patterns:
- "What scenarios exist for project X?"
- "What was the last verdict for scenario Y?"
- "What runs failed?"
- "What tasks are in progress?"
- "Show the last N runs"
- "What verdicts were issued since date D?"
- "How many rows are in each table?"
(See lib/oracle-queries.mjs for the full list)

Tip: Try rephrasing with keywords like "scenario", "verdict", "runs", "tasks", "project".
```

## Filter Flags

| Flag | Effect |
|------|--------|
| `--project <name>` | Narrow results to a single project (by name) |
| `--status <status>` | Filter by status field (passed/failed/open/in_progress/done/blocked) |
| `--since <date>` | Only return records with created_at or started_at >= this ISO date |

Invalid filter values (e.g. `--status gibberish`) return `ERR_FILTER_INVALID` — not a crash.

## Integration

- Works after `/wicked-testing:run` or `/wicked-testing:acceptance` have produced records
- Answers questions about `/wicked-testing:tasks` work items
- Powers `/wicked-testing:stats` row count display
- Bootstrap verification: `/wicked-testing:oracle "show bootstrap verdict"` → confirms PASS after install
