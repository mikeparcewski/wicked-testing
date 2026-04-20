---
description: Generate browser/performance test harness scaffold for a scenario file
argument-hint: "[scenario-file] [--framework playwright|cypress|k6] [--json]"
---

# /wicked-testing:automate

Detect browser automation tools and generate test harness scaffolds for wicked-testing scenarios.

## Usage

```
/wicked-testing:automate [scenario-file] [--framework playwright|cypress|k6] [--json]
```

- `scenario-file` — scenario `.md` file to generate automation for (optional)
- `--framework` — force a specific framework (overrides auto-detection)
- `--json` — emit JSON envelope

## Instructions

### 1. Detect Tools

```bash
command -v playwright > /dev/null 2>&1 && echo "playwright: ok" || npx playwright --version > /dev/null 2>&1 && echo "playwright (npx): ok"
command -v cypress > /dev/null 2>&1 && echo "cypress: ok" || npx cypress --version > /dev/null 2>&1 && echo "cypress (npx): ok"
command -v k6 > /dev/null 2>&1 && echo "k6: ok" || echo "k6: missing"
```

Apply priority: playwright > cypress > k6 > puppeteer (or use `--framework` override).

If no tool is found, provide install instructions and stop.

### 2. Generate Scaffold

Based on detected tool and scenario category, generate appropriate scaffold files.
See `skills/browser-automation/SKILL.md` for scaffold templates.

### 3. Output

Without `--json` — Return scaffold summary with file paths and run commands.

With `--json` — Emit the JSON envelope:

```bash
python3 -c "import json,sys; sys.stdout.write(json.dumps({'ok': True, 'data': {'framework': '...', 'files_created': ['tests/...'], 'run_command': 'npx playwright test'}, 'meta': {'command': 'wicked-testing:automate', 'duration_ms': 0, 'schema_version': 1, 'store_mode': '...'}}))" 2>/dev/null || python -c "..."
```
