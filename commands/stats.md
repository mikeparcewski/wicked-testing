---
description: Show domain health — row counts, recent activity, schema version, store mode
argument-hint: "[--rebuild-index] [--json]"
---

# /wicked-testing:stats

Show domain health: row counts for all 7 tables, recent activity, schema version, and store mode.

## Usage

```
/wicked-testing:stats [--rebuild-index] [--json]
```

- `--rebuild-index` — rebuild SQLite index from JSON files (escape hatch only)
- `--json` — emit JSON envelope

## Instructions

### 1. Check Store Mode

Determine if SQLite is available:
```bash
test -f ".wicked-testing/wicked-testing.db" && echo "sqlite" || echo "json-only"
```

### 2. Get Row Counts

**SQLite mode** — query row counts via oracle:

```bash
sqlite3 -json ".wicked-testing/wicked-testing.db" "
  SELECT
    (SELECT COUNT(*) FROM projects WHERE deleted = 0) as projects,
    (SELECT COUNT(*) FROM strategies WHERE deleted = 0) as strategies,
    (SELECT COUNT(*) FROM scenarios WHERE deleted = 0) as scenarios,
    (SELECT COUNT(*) FROM runs WHERE deleted = 0) as runs,
    (SELECT COUNT(*) FROM verdicts WHERE deleted = 0) as verdicts,
    (SELECT COUNT(*) FROM tasks WHERE deleted = 0) as tasks,
    (SELECT COUNT(*) FROM schema_migrations) as schema_migrations
"
```

**JSON-only mode** — count files in each directory via Python so the glob,
stderr suppression, and line-count are all cross-platform (Windows Git Bash
does not ship `wc`, and `ls ... 2>/dev/null` leaks on some shells):

```bash
python3 -c "import pathlib; \
  [print(f'{d}: {len(list(pathlib.Path(\".wicked-testing\",d).glob(\"*.json\")))}') \
    for d in ['projects','strategies','scenarios','runs','verdicts','tasks']]" \
  2>/dev/null \
  || python -c "import pathlib; \
  [print(f'{d}: {len(list(pathlib.Path(\".wicked-testing\",d).glob(\"*.json\")))}') \
    for d in ['projects','strategies','scenarios','runs','verdicts','tasks']]"
```

Annotate as `"mode": "json-only"` in the output.

### 3. Get Recent Activity

```bash
# Runs in last 7 days
sqlite3 ".wicked-testing/wicked-testing.db" "
  SELECT COUNT(*) FROM runs
  WHERE started_at >= datetime('now', '-7 days')
    AND deleted = 0
"

# Open tasks
sqlite3 ".wicked-testing/wicked-testing.db" "
  SELECT COUNT(*) FROM tasks
  WHERE status = 'open' AND deleted = 0
"

# Most recent project
sqlite3 ".wicked-testing/wicked-testing.db" "
  SELECT name, updated_at FROM projects
  WHERE deleted = 0
  ORDER BY updated_at DESC LIMIT 1
"
```

### 4. Get Schema Version

```bash
sqlite3 ".wicked-testing/wicked-testing.db" "
  SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1
"
```

### 5. Handle --rebuild-index

If `--rebuild-index` flag is present, run the DomainStore rebuild:

```bash
node -e "
import('./lib/domain-store.mjs').then(({DomainStore}) => {
  const store = new DomainStore('.wicked-testing');
  store.rebuildIndex();
  store.close();
  console.log('Index rebuilt successfully');
});
"
```

### 6. Output

Without `--json`:

```markdown
## wicked-testing Domain Stats

**Store mode**: {sqlite+json | json-only}
**Schema version**: {1}

### Row Counts

| Table | Rows |
|-------|------|
| projects | {N} |
| strategies | {N} |
| scenarios | {N} |
| runs | {N} |
| verdicts | {N} |
| tasks | {N} |
| schema_migrations | {N} |

### Recent Activity

- **Runs (last 7 days)**: {N}
- **Open tasks**: {N}
- **Most recent project**: {name} (updated {timestamp})

{If json-only mode:}
WARNING: SQLite index unavailable. Row counts are file-based estimates.
Oracle and filter queries are not available. Run /wicked-testing:setup to repair.
```

With `--json` — Emit the JSON envelope:

```bash
python3 -c "import json,sys; sys.stdout.write(json.dumps({'ok': True, 'data': {'store_mode': 'sqlite+json', 'schema_version': 1, 'counts': {'projects': N, 'strategies': N, 'scenarios': N, 'runs': N, 'verdicts': N, 'tasks': N}, 'recent': {'runs_7d': N, 'open_tasks': N, 'latest_project': '...'}}, 'meta': {'command': 'wicked-testing:stats', 'duration_ms': 0}}))" 2>/dev/null || python -c "..."
```

In JSON-only mode, `data.store_mode` is `"json-only"` and `data.counts` contains file counts.
