---
name: test-runner
description: |
  Execute wicked-testing scenario files via the appropriate CLI tool.
  Writes run records and evidence JSON to .wicked-testing/evidence/{run-id}/.
  Records run in DomainStore.

  Use when: "run scenario", "execute test", "run tests", "test execution",
  "run this scenario", "execute scenario", "run the self-test",
  "/wicked-testing:run"
---

# Test Runner Skill

Execute wicked-testing scenario files using the appropriate CLI tool (playwright, cypress, k6, bash). Collect evidence JSON and write run records to the DomainStore.

## What This Skill Does

1. Parses the scenario file (frontmatter + steps)
2. Discovers required CLI tools
3. Executes each step, capturing stdout/stderr/exit codes
4. Writes a timestamped evidence JSON to `.wicked-testing/evidence/{run-id}/evidence.json`
5. Creates a `runs` record in the DomainStore
6. Returns PASS/FAIL/PARTIAL based on step results

## Command

```
/wicked-testing:run <scenario-file> [--json]
```

- `scenario-file` — path to a wicked-testing scenario `.md` file
- `--json` — emit JSON envelope output

## Instructions

### 1. Parse Scenario

Read the scenario file. Extract YAML frontmatter:
- `name` — scenario identifier
- `description` — what this tests
- `category` — api|browser|perf|infra|security|a11y|cli
- `tools.required` — CLIs that must be available
- `tools.optional` — CLIs used if available
- `timeout` — max seconds (default: 120)

### 2. Discover CLI Tools

For each required and optional tool, check availability:

```bash
command -v playwright > /dev/null 2>&1 && echo "playwright: available" || echo "playwright: missing"
command -v cypress > /dev/null 2>&1 && echo "cypress: available" || echo "cypress: missing"
command -v k6 > /dev/null 2>&1 && echo "k6: available" || echo "k6: missing"
command -v npx > /dev/null 2>&1 && echo "npx: available" || echo "npx: missing"
```

If a required tool is missing, mark dependent steps as SKIPPED and degrade to PARTIAL.

### 3. Ensure Project + Scenario in DomainStore

Ensure a project record exists (or use `.wicked-testing/config.json` project). Ensure a scenario row exists for this file — create one if not present.

### 4. Create Run Record

```javascript
const run = store.create('runs', {
  project_id: projectId,
  scenario_id: scenarioId,
  started_at: now(),
  status: 'running'
});
const evidenceDir = `.wicked-testing/evidence/${run.id}`;
```

### 5. Execute Setup

If the scenario has a `## Setup` section, execute its bash block and capture output.

### 6. Execute Steps

For each `### Step N:` section in order:

1. Extract the fenced code block
2. Identify the CLI from the step header `(cli-name)` or code fence language
3. If CLI is not available → record as SKIPPED
4. Execute via Bash with timeout
5. Capture: stdout, stderr, exit code, wall-clock duration
6. Determine result: exit code 0 → PASS, non-zero → FAIL, CLI missing → SKIPPED

```bash
# Example step execution — portable timeout chain
# Prefer `lib/exec-with-timeout.mjs` (Node wrapper) when available;
# otherwise use the shell fallback below. GNU `timeout` is absent from stock
# macOS and Windows Git Bash, so chain `timeout → gtimeout → bare`.
if command -v timeout >/dev/null 2>&1; then
  timeout "${TIMEOUT:-120}" bash -c '{step_command}' > "step-${N}.stdout" 2> "step-${N}.stderr"
elif command -v gtimeout >/dev/null 2>&1; then
  gtimeout "${TIMEOUT:-120}" bash -c '{step_command}' > "step-${N}.stdout" 2> "step-${N}.stderr"
else
  echo "warn: no timeout/gtimeout on PATH; running without enforced timeout" >&2
  bash -c '{step_command}' > "step-${N}.stdout" 2> "step-${N}.stderr"
fi
EXIT_CODE=$?
```

### 7. Execute Cleanup

If the scenario has a `## Cleanup` section, execute it (always, even on failure).

### 8. Write Evidence JSON

Write the evidence file to the run directory:

```json
{
  "scenario": "{name}",
  "run_id": "{run.id}",
  "started_at": "{ISO timestamp}",
  "finished_at": "{ISO timestamp}",
  "status": "passed|failed|partial",
  "steps": [
    {
      "name": "{step description}",
      "tool": "{cli tool}",
      "exit_code": 0,
      "stdout": "{captured stdout}",
      "stderr": "{captured stderr}",
      "duration_ms": 234,
      "result": "PASS|FAIL|SKIPPED"
    }
  ],
  "missing_tools": [{"tool": "k6", "install": "brew install k6"}],
  "skipped_steps": [{"name": "...", "reason": "Tool 'k6' not available"}]
}
```

Use `scripts/_python.sh` Python pattern to write JSON cross-platform:

```bash
python3 -c "import json,sys; sys.stdout.write(json.dumps({...}))" 2>/dev/null \
  || python -c "import json,sys; sys.stdout.write(json.dumps({...}))"
```

### 9. Update Run Record in DomainStore

```javascript
store.update('runs', run.id, {
  finished_at: now(),
  status: overallStatus,   // 'passed' | 'failed' | 'error'
  evidence_path: evidenceDir
});
```

### 10. Output

**Without `--json`** — Markdown report:

```markdown
## Scenario Results: {name}

**Status**: {PASS|FAIL|PARTIAL}
**Duration**: {total}s
**Steps**: {pass} passed, {fail} failed, {skip} skipped

| Step | Status | Duration | Details |
|------|--------|----------|---------|
| {name} | PASS | 0.5s | |
| {name} | FAIL | 2.0s | Exit code 1: {stderr snippet} |

Evidence: .wicked-testing/evidence/{run-id}/evidence.json
Run ID: {run-id} (query with /wicked-testing:oracle)
```

**With `--json`** — Use `scripts/_python.sh` for the JSON envelope. Evidence file path in `data.evidence_path`.

## Overall Status

- All steps PASS → **PASS** (exit 0)
- Any step FAIL → **FAIL** (exit 1)
- No FAILs but some SKIPPEDs → **PARTIAL** (exit 2)

## Integration

- Run records queryable via `/wicked-testing:oracle`
- Evidence files read by `/wicked-testing:acceptance` reviewer
- Reports generated by `/wicked-testing:report`
- Stats shown by `/wicked-testing:stats`
