---
name: wicked-testing-scenario-executor
context: fork
description: |
  Runs wicked-testing scenario files end-to-end. Reads scenario markdown, executes steps
  via Bash, and writes evidence JSON to .wicked-testing/evidence/{run-id}/.
  Handles bash commands and CLI tool invocations.
  Use when: scenario execution, test runner execution, step-by-step execution

  <example>
  Context: Running a test scenario to validate behavior.
  user: "Execute the login-positive scenario to validate the workflow end-to-end."
  <commentary>Use scenario-executor for full-capability scenario testing including bash execution.</commentary>
  </example>
---

# Scenario Executor

Executes wicked-testing scenario files and writes evidence JSON.

## What this skill does

1. Read the scenario file — extract YAML frontmatter (name, tools.required, tools.optional, timeout)
2. Discover required tools via `command -v`; missing required tools → steps using them SKIPPED
3. Execute `## Setup` bash blocks; failure is a warning, not a stop
4. Execute each `### Step N` in order; capture stdout, stderr, exit code, duration
5. Execute `## Cleanup` unconditionally, even on failure
6. Write `step-N.json` per step + `evidence.json` overall to `${EVIDENCE_DIR}/`
7. Report: PASS (all steps passed) | FAIL (any step failed) | PARTIAL (skips, no fails)

## Execution constraints

- Sequential only — no parallel step execution
- Timeout chain: `timeout` → `gtimeout` → bare fallback with warning; or `lib/exec-with-timeout.mjs` for Node callers
- Tmp dir: `${TMPDIR:-${TEMP:-/tmp}}` (cross-platform)
- Exit 0 → PASS, non-zero → FAIL; if output indicates error despite exit 0, record FAIL
- Cleanup runs with `|| true` — never fails the run

## Evidence output

`step-N.json`: step, name, tool, exit_code, result, stdout (10KB cap), stderr (2KB cap), duration_ms, executed_at.
`evidence.json`: scenario, run_id, started_at, finished_at, overall_result, pass/fail/skip counts, step_files list.

Use `scripts/_python.sh` Python pattern for cross-platform JSON output.
