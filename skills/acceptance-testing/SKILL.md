---
name: acceptance-testing
description: |
  Evidence-gated acceptance testing with three-agent separation of concerns.
  Writer designs test plans, Executor collects artifacts, Reviewer evaluates independently.
  Eliminates false positives from self-grading.

  Use when: "acceptance test", "verify it works", "did it pass", "run acceptance",
  "test this scenario", "acceptance criteria", "validate the feature",
  "/wicked-testing:acceptance"

# REVIEWER ISOLATION NOTE: This skill enforces three isolation layers for the reviewer:
# 1. allowed-tools: [Read] only (see agents/acceptance-test-reviewer.md)
# 2. Evidence-only dispatch: reviewer receives ONLY file paths, test plan, scenario path
# 3. Subagent context boundary: reviewer runs as separate subagent invocation
# Enforcement is guaranteed on Claude Code; advisory on other CLIs.
---

# Acceptance Testing Skill

Three-agent pipeline that separates test writing, execution, and review for higher-fidelity acceptance testing.

## The Problem with Self-Grading

When the same agent executes and grades tests, it pattern-matches "something happened" as success:

- Command produced output → "PASS" (but output was wrong)
- File was created → "PASS" (but contents are incorrect)
- No errors → "PASS" (but the feature didn't activate)

**Result**: 80%+ false positive rate on qualitative criteria.

## Three-Agent Architecture

```
Writer ──→ Test Plan ──→ Executor ──→ Evidence ──→ Reviewer ──→ Verdict
```

| Agent | Role | What it catches |
|-------|------|-----------------|
| **Writer** | Reads scenario + implementation code → structured test plan with evidence gates | Specification bugs |
| **Executor** | Follows plan step-by-step → collects artifacts, no judgment | Runtime bugs |
| **Reviewer** | Evaluates cold evidence against assertions | Semantic bugs |

## CRITICAL: Reviewer Isolation (3 Layers)

The reviewer must NEVER receive executor conversation context. This is enforced through:

1. **Tool restriction**: `allowed-tools: [Read]` in `agents/acceptance-test-reviewer.md`. On Claude Code, this is enforced at the host level. On other CLIs, this is advisory.
2. **Evidence-only dispatch**: The reviewer is dispatched with ONLY:
   - The original scenario file path
   - The evidence directory path (`.wicked-testing/runs/{run-id}/`)
   - The test plan (writer output)
   - It does NOT include: executor stdout, executor reasoning, or any executor conversational context
3. **Subagent context boundary**: The reviewer runs as a separate subagent invocation, not sharing history with the executor.

See `agents/acceptance-test-reviewer.md` for the reviewer's isolation annotation.

## Reviewer Isolation Enforcement Tiers

| CLI | Isolation enforcement |
|-----|-----------------------|
| Claude Code | Hard-enforced (tool restriction at host level) |
| Gemini CLI | Advisory (skill enforces evidence-only dispatch; host does not block tools) |
| Codex, Copilot | Advisory only |

Tests tagged `@requires-enforcement: claude-code` validate the hard tier.
Tests without that tag validate the skill's dispatch contract (valid everywhere).

## Command

```
/wicked-testing:acceptance <scenario-file> [--phase write|execute|review|all] [--json]
```

- `scenario-file` — path to a wicked-testing scenario .md file
- `--phase all` (default) — full Write → Execute → Review pipeline
- `--phase write` — generate test plan only (for review before execution)
- `--phase execute` — execute with existing plan
- `--phase review` — review existing evidence
- `--json` — emit JSON envelope

## Instructions

### 0. Resolve Paths

```bash
WICKED_DIR=".wicked-testing"
RUN_ID="$(date +%Y%m%dT%H%M%S)-$(basename ${SCENARIO_FILE%.md})"
EVIDENCE_DIR="${WICKED_DIR}/runs/${RUN_ID}"
```

Ensure project and scenario records exist in DomainStore before proceeding.

### 1. Parse Scenario

Read the scenario file. Extract:
- Frontmatter: name, description, tags, assertions
- Steps: extract step descriptions for test plan guidance
- Ensure scenario row exists in DomainStore (create if not present)

### 2. Phase: Write (Test Plan Generation)

Dispatch the `acceptance-test-writer` subagent:

```
Task(
  subagent_type="wicked-testing:acceptance-test-writer",
  prompt="""Generate an evidence-gated test plan for this acceptance scenario.

## Scenario
{scenario file content}

## Scenario Source
{file path}

## Instructions
1. Read the scenario thoroughly
2. Find and read the implementation code referenced in the scenario
3. Design evidence requirements for every step
4. Write concrete, independently-verifiable assertions
5. Map every success criterion to specific assertions
6. Flag any specification mismatches you discover

Return the complete test plan in the standard format.
"""
)
```

If `--phase write`, stop here.

### 3. Phase: Execute (Evidence Collection)

Create run record in DomainStore before dispatching executor:

```javascript
const run = store.create('runs', {
  project_id: ..., scenario_id: ...,
  started_at: now(), status: 'running'
});
```

Dispatch the `acceptance-test-executor` subagent:

```
Task(
  subagent_type="wicked-testing:acceptance-test-executor",
  prompt="""Execute this test plan and collect evidence artifacts.

## Test Plan
{test plan content}

## Evidence Directory
{EVIDENCE_DIR}

## Rules
1. Execute each step exactly as written
2. Write evidence files to: {EVIDENCE_DIR}/
3. Write evidence.json summary to: {EVIDENCE_DIR}/evidence.json
4. Do NOT judge results — only record what happened
5. Continue to next step even if current step fails
6. Record timestamps for every step

Return the complete evidence report.
"""
)
```

Update run status in DomainStore after execution.

If `--phase execute`, stop here.

### 4. Phase: Pre-Review Cold Context (Optional)

If wicked-brain is present, gather NON-PREJUDICIAL cold knowledge and write it
to `${EVIDENCE_DIR}/context.md` before dispatching the reviewer. This gives the
reviewer access to domain rules and environment caveats without breaking the
cold-evidence isolation.

**Allowed** in `context.md`:
- Domain rules (WCAG AA thresholds, HTTP semantics, framework behavior)
- Tool/env quirks ("docker compose v1 vs v2", "hurl on macOS requires flag X")
- Assertion semantics explanations

**MUST NOT** be written to `context.md` (would reintroduce self-grading):
- Prior verdicts for this scenario (never query `verdicts` by scenario_id)
- Historical pass/fail rates
- Executor reasoning, expectations, or stdout/stderr
- Any content derived from this run

Example safe query:

```
wicked-brain:search query="<scenario-category> test rules" limit=5
```

If wicked-brain is absent, skip this phase — no `context.md` is written and
the reviewer still has everything it needs (scenario + plan + evidence).

### 5. Phase: Review (Evidence Evaluation — ISOLATION CRITICAL)

**CRITICAL ISOLATION**: The reviewer receives ONLY evidence file paths and the test plan.
It does NOT receive the executor's conversation, reasoning, or stdout/stderr directly.
Pass paths, not content, where possible.

```
Task(
  subagent_type="wicked-testing:acceptance-test-reviewer",
  prompt="""Review the evidence against the test plan assertions.

## Scenario Path
{scenario file path only — reviewer reads it independently}

## Test Plan Path
{evidence dir}/{test-plan.md}

## Evidence Directory
{EVIDENCE_DIR}
(May contain an optional context.md with pre-vetted cold domain knowledge —
treat it as evidence. If it contains prior verdicts or historical outcomes,
flag as CONTEXT_CONTAMINATION and return INCONCLUSIVE.)

## Instructions
1. Read the scenario file at the path above
2. Read the test plan file at the path above
3. Read evidence files from the evidence directory (including context.md if present)
4. Evaluate each assertion against evidence
5. Return verdict: PASS | FAIL | INCONCLUSIVE

DO NOT reference any execution context beyond the files above.
"""
)
```

**Note**: The reviewer prompt intentionally omits all executor conversation context.
This is the evidence-only dispatch — the third isolation layer.

### 6. Write Verdict to DomainStore

```javascript
store.create('verdicts', {
  run_id: run.id,
  verdict: reviewerVerdict,   // 'PASS' | 'FAIL'
  evidence_path: EVIDENCE_DIR,
  reviewer: 'acceptance-test-reviewer',
  reason: reviewerSummary
});
store.update('runs', run.id, {
  finished_at: now(),
  status: reviewerVerdict === 'PASS' ? 'passed' : 'failed',
  evidence_path: EVIDENCE_DIR
});
```

### 7. Output

**Without `--json`** — Present the full verdict:

```markdown
## Acceptance Test Results: {scenario name}

### Verdict: {PASS | FAIL | INCONCLUSIVE}

### Acceptance Criteria
| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| {criterion} | PASS/FAIL | {evidence citation} |

### Failures (if any)
- **{assertion}**: Expected {X}, found {Y}. Cause: {taxonomy}

*Run ID: {run_id} | Evidence: {EVIDENCE_DIR}*
*Verdict written to DomainStore — query with /wicked-testing:oracle*
```

**With `--json`** — Use `scripts/_python.sh` Python pattern for the JSON envelope.

## Integration

- Results queryable via `/wicked-testing:oracle "what was the last verdict for scenario X?"`
- Evidence files at `.wicked-testing/runs/{run-id}/`
- Verdict written to DomainStore `verdicts` table
- Run written to DomainStore `runs` table
