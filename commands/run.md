---
description: Execute a wicked-testing scenario file and write evidence JSON to .wicked-testing/runs/
argument-hint: "<scenario-file> [--json]"
---

# /wicked-testing:run

Execute a scenario file using the appropriate CLI tool. Writes a timestamped evidence JSON to `.wicked-testing/runs/{run-id}/` and records the run in the DomainStore.

## Usage

```
/wicked-testing:run <scenario-file> [--json]
```

- `scenario-file` — path to a wicked-testing scenario `.md` file (required)
- `--json` — emit JSON envelope output

## Instructions

### 1. Validate Input

Verify the scenario file exists:
```bash
test -f "{scenario-file}" || echo "ERR_SCENARIO_NOT_FOUND: {scenario-file} does not exist"
```

If the file doesn't exist, return the JSON error envelope (or markdown error) and stop.

### 2. Check Config

If `.wicked-testing/config.json` is missing, prompt:
```
Config not found. Run /wicked-testing:setup first.
Code: ERR_NO_CONFIG
```

### 3. Dispatch scenario-executor

Dispatch the `scenario-executor` agent:

```
Task(
  subagent_type="wicked-testing:scenario-executor",
  prompt="""Execute this wicked-testing scenario file and write evidence.

## Scenario File
{scenario-file path}

## Evidence Directory
.wicked-testing/runs/{run-id}/

## Instructions
1. Read the scenario file
2. Execute each step in order
3. Capture stdout, stderr, and exit codes for each step
4. Write step-{N}.json evidence files to the evidence directory
5. Write evidence.json summary to the evidence directory
6. Return overall PASS/FAIL/PARTIAL result

Run ID: {run-id}
"""
)
```

### 4. Write Run Record to DomainStore

Before dispatching, create a run record (status: 'running').
After the agent returns, update the run record with final status and evidence path.

### 5. Exit Codes

- PASS: exit 0
- FAIL: exit 1
- PARTIAL (some SKIPPEDs): exit 2

### 6. Output

Without `--json` — Return the executor's result report.

With `--json` — Emit the JSON envelope:

```bash
python3 -c "import json,sys; sys.stdout.write(json.dumps({'ok': True, 'data': {'run_id': '...', 'status': 'passed', 'evidence_path': '.wicked-testing/runs/...', 'pass_count': N, 'fail_count': 0, 'skip_count': 0}, 'meta': {'command': 'wicked-testing:run', 'duration_ms': 0, 'schema_version': 1, 'store_mode': '...'}}))" 2>/dev/null || python -c "..."
```

On FAIL, `ok` is `false` and `error` describes the failure.
