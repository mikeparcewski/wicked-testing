---
description: Answer plain-language questions about your test data using fixed parameterized SQL queries
argument-hint: "\"<question>\" [--project <name>] [--status <status>] [--since <date>] [--json]"
---

# /wicked-testing:oracle

Answer plain-language questions about your testing history. Uses a fixed library of 12 parameterized SQL queries — no ad-hoc SQL, no LLM-generated SQL, no SQL injection vectors.

## Usage

```
/wicked-testing:oracle "<question>" [--project <name>] [--status <status>] [--since <date>] [--json]
```

- `question` — natural-language question about your test data (required)
- `--project <name>` — filter results to this project
- `--status <status>` — filter by status (passed/failed/running/open/in_progress/done/blocked)
- `--since <date>` — ISO date filter (e.g. 2026-01-01)
- `--json` — emit JSON envelope

## Example Questions

```bash
/wicked-testing:oracle "What scenarios exist for the auth-service project?"
/wicked-testing:oracle "What was the last verdict for the login scenario?"
/wicked-testing:oracle "What tasks are in progress?"
/wicked-testing:oracle "Show the last 10 runs"
/wicked-testing:oracle "What failed since 2026-01-01?"
/wicked-testing:oracle "show bootstrap verdict"
/wicked-testing:oracle --project auth-service "What scenarios exist?"
/wicked-testing:oracle --status failed "What runs failed?"
```

## Instructions

### 1. Check SQLite Availability

```bash
test -f ".wicked-testing/wicked-testing.db" || echo "DB_MISSING"
```

If the database is missing or SQLite is unavailable, return:

```bash
python3 -c "import json,sys; sys.stdout.write(json.dumps({'ok': False, 'error': 'SQLite unavailable — oracle requires database index. Run /wicked-testing:setup to repair.', 'code': 'ERR_SQLITE_UNAVAILABLE', 'meta': {'command': 'wicked-testing:oracle', 'duration_ms': 0, 'store_mode': 'json-only'}}))" 2>/dev/null || python -c "..."
```

### 2. Dispatch test-oracle agent

Dispatch the `test-oracle` agent with the question and filters:

```
Task(
  subagent_type="wicked-testing:test-oracle",
  prompt="""Answer this question about the wicked-testing data domain.

## Question
{question}

## Filters
- project: {project or null}
- status: {status or null}
- since: {since or null}

## Output format
{--json was passed: "Return JSON" | "Return markdown"}

## Instructions
1. Check SQLite availability
2. Route the question to the appropriate named query
3. Execute the query via sqlite3 CLI
4. Format and return the answer
"""
)
```

### 3. Handle ERR_FILTER_INVALID

If a filter value is invalid (e.g. `--status gibberish`), return:

```bash
python3 -c "import json,sys; sys.stdout.write(json.dumps({'ok': False, 'error': 'Invalid filter value for --status: gibberish. Allowed: running|passed|failed|error|open|in_progress|done|blocked', 'code': 'ERR_FILTER_INVALID', 'meta': {'command': 'wicked-testing:oracle', 'duration_ms': 0}}))" 2>/dev/null || python -c "..."
```

### 4. Output

Without `--json` — Return the agent's markdown response.

With `--json` — Emit the JSON envelope from the agent's response.
