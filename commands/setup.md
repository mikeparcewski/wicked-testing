---
description: Initialize wicked-testing for this project — detect CLI tools, create config, register project in DomainStore
argument-hint: "[--project <name>] [--json]"
---

# /wicked-testing:setup

Initialize wicked-testing for the current project. Creates `.wicked-testing/config.json`, detects available test CLIs, and registers a project record in the DomainStore.

## Usage

```
/wicked-testing:setup [--project <name>] [--json]
```

- `--project <name>` — project name to register (defaults to directory name)
- `--json` — emit JSON envelope output

## Instructions

### 1. Detect Available Test CLIs

Check for test CLI tools:

```bash
command -v playwright > /dev/null 2>&1 && echo "playwright: true" || echo "playwright: false"
command -v cypress > /dev/null 2>&1 && echo "cypress: true" || echo "cypress: false"
command -v k6 > /dev/null 2>&1 && echo "k6: true" || echo "k6: false"
command -v curl > /dev/null 2>&1 && echo "curl: true" || echo "curl: false"
command -v pa11y > /dev/null 2>&1 && echo "pa11y: true" || echo "pa11y: false"
npx playwright --version > /dev/null 2>&1 && echo "npx-playwright: true" || echo "npx-playwright: false"
npx cypress --version > /dev/null 2>&1 && echo "npx-cypress: true" || echo "npx-cypress: false"
```

### 2. Create .wicked-testing Directory

```bash
mkdir -p .wicked-testing/projects .wicked-testing/strategies .wicked-testing/scenarios \
         .wicked-testing/runs .wicked-testing/verdicts .wicked-testing/tasks
```

### 3. Write config.json

Write `.wicked-testing/config.json` using Python cross-platform pattern:

```bash
python3 -c "
import json, sys, os
config = {
    'project': os.path.basename(os.getcwd()),
    'version': '1.0',
    'capabilities': {
        'playwright': False,
        'cypress': False,
        'k6': False,
        'curl': True,
        'pa11y': False
    },
    'created_at': __import__('datetime').datetime.utcnow().isoformat() + 'Z'
}
sys.stdout.write(json.dumps(config, indent=2))
" 2>/dev/null || python -c "..."
```

Update the capabilities based on detection results from Step 1.

### 4. Register Project in DomainStore

Determine project name: use `--project` arg, or basename of current directory.

Write a project record. If SQLite is available, it will be indexed; otherwise JSON-only.

If SQLite is unavailable, print a warning:
```
WARNING: better-sqlite3 not available — store running in JSON-only mode.
Oracle and stats commands require SQLite. Run: npm rebuild better-sqlite3
```

### 5. Output

**Without `--json`**:

```markdown
## wicked-testing Setup Complete

**Project**: {name}
**Store mode**: {sqlite+json | json-only}

### Capabilities Detected

| Tool | Status |
|------|--------|
| playwright | {Installed / Not found} |
| cypress | {Installed / Not found} |
| k6 | {Installed / Not found} |
| curl | {Installed / Not found} |
| pa11y | {Installed / Not found} |

**Config**: .wicked-testing/config.json
**Project ID**: {id}

Next steps:
- `/wicked-testing:plan` — create a test strategy
- `/wicked-testing:scenarios` — author test scenarios
- `/wicked-testing:acceptance scenarios/test-runner.md` — run acceptance test pipeline
```

**With `--json`** — emit the JSON envelope via Python pattern:

```bash
python3 -c "import json,sys; sys.stdout.write(json.dumps({'ok': True, 'data': {'project': '{name}', 'project_id': '{id}', 'capabilities': {...}, 'store_mode': '...'}, 'meta': {'command': 'wicked-testing:setup', 'duration_ms': 0, 'schema_version': 1, 'store_mode': '...' }}))" 2>/dev/null || python -c "..."
```
