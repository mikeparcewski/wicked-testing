---
description: Run the 3-agent acceptance pipeline (Writer → Executor → Reviewer) on a scenario file
argument-hint: "<scenario-file> [--phase write|execute|review|all] [--json]"
---

# /wicked-testing:acceptance

Evidence-gated 3-agent acceptance testing pipeline. Writer designs test plans, Executor collects artifacts, Reviewer evaluates independently — eliminating self-grading false positives.

## Usage

```
/wicked-testing:acceptance <scenario-file> [--phase write|execute|review|all] [--json]
```

- `scenario-file` — path to a wicked-testing scenario `.md` file (required)
- `--phase all` (default) — full Write → Execute → Review pipeline
- `--phase write` — generate test plan only
- `--phase execute` — run execution with existing plan
- `--phase review` — review existing evidence
- `--json` — emit JSON envelope

## Instructions

### 1. Validate Input

Check scenario file exists:
```bash
test -f "{scenario-file}" || echo "ERR_SCENARIO_NOT_FOUND"
```

Check config:
```bash
test -f ".wicked-testing/config.json" || echo "ERR_NO_CONFIG"
```

### 2. Set Up Run Context

```bash
RUN_ID="$(date +%Y%m%dT%H%M%S)-$(basename '{scenario-file}' .md)"
EVIDENCE_DIR=".wicked-testing/runs/${RUN_ID}"
mkdir -p "${EVIDENCE_DIR}"
```

Ensure project and scenario records exist in DomainStore (create if needed).
Create run record with status 'running'.

### 3. Invoke the acceptance-testing skill

The acceptance-testing skill (see `skills/acceptance-testing/SKILL.md`) orchestrates the 3-agent pipeline.

Follow the instructions in that skill file exactly, including:
- Dispatching `acceptance-test-writer` for the test plan
- Dispatching `acceptance-test-executor` with test plan + evidence directory
- Dispatching `acceptance-test-reviewer` with ONLY evidence paths (REVIEWER ISOLATION)
- Writing verdict and updating run in DomainStore

### 4. REVIEWER ISOLATION (CRITICAL)

The reviewer MUST receive only:
- Scenario file path
- Evidence directory path
- Test plan (written to evidence directory by executor)

The reviewer MUST NOT receive:
- Executor stdout/stderr directly
- Executor reasoning or explanations
- Any executor conversational context

See `skills/acceptance-testing/SKILL.md` for the exact dispatch prompt.

### 5. Output

Without `--json` — Return the verdict with acceptance criteria table.

With `--json` — Emit the JSON envelope:

```bash
python3 -c "import json,sys; sys.stdout.write(json.dumps({'ok': True, 'data': {'verdict': 'PASS', 'run_id': '...', 'evidence_path': '...', 'assertions_passed': N, 'assertions_failed': 0}, 'meta': {'command': 'wicked-testing:acceptance', 'duration_ms': 0, 'schema_version': 1, 'store_mode': '...'}}))" 2>/dev/null || python -c "..."
```

On FAIL, `ok` remains `true` but `data.verdict` is `'FAIL'` and `data.failures` lists the failures.
