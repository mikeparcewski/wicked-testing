---
description: Generate a markdown summary of test runs and verdicts from the DomainStore
argument-hint: "[--project <name>] [--since <date>] [--json]"
---

# /wicked-testing:report

Generate a markdown summary of test run history and verdicts. Reads from `.wicked-testing/wicked-testing.db` (or falls back to JSON files in JSON-only mode).

## Usage

```
/wicked-testing:report [--project <name>] [--since <date>] [--json]
```

- `--project <name>` — filter to a specific project
- `--since <date>` — only show runs after this ISO date
- `--json` — emit JSON envelope

## Instructions

### 1. Determine Store Mode

Check for SQLite availability. Report will be annotated with `"mode": "json-only"` if SQLite is unavailable.

### 2. Query Run History

**SQLite mode**:

```bash
sqlite3 -json ".wicked-testing/wicked-testing.db" "
  SELECT r.id, r.status, r.started_at, r.finished_at,
         s.name as scenario_name, p.name as project_name,
         v.verdict, v.reason
  FROM runs r
  JOIN scenarios s ON r.scenario_id = s.id
  JOIN projects p ON r.project_id = p.id
  LEFT JOIN verdicts v ON v.run_id = r.id AND v.deleted = 0
  WHERE r.deleted = 0
  ORDER BY r.started_at DESC
  LIMIT 50
"
```

**JSON-only fallback**: Scan `.wicked-testing/runs/` directory for JSON evidence files and read directly.

### 3. Calculate Summary Statistics

- Total runs
- Pass/fail/partial breakdown
- Most recent run timestamp
- Per-scenario last-run status

### 4. Output

Without `--json`: produce the markdown summary report with summary table and per-scenario status table.

With `--json` — Emit the JSON envelope:

```bash
python3 -c "import json,sys; sys.stdout.write(json.dumps({'ok': True, 'data': {'total_runs': 0, 'passed': 0, 'failed': 0, 'partial': 0, 'most_recent': None, 'runs': [], 'store_mode': 'sqlite+json'}, 'meta': {'command': 'wicked-testing:report', 'duration_ms': 0, 'schema_version': 1, 'store_mode': 'sqlite+json'}}))" 2>/dev/null || python -c "import json,sys; sys.stdout.write(json.dumps({'ok': True, 'data': {'total_runs': 0, 'store_mode': 'sqlite+json'}, 'meta': {'command': 'wicked-testing:report', 'duration_ms': 0}}))"
```
