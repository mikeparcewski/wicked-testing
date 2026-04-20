---
name: wicked-testing-evals
description: |
  On-demand eval runner for wicked-testing's agents. Dispatches each case from
  evals/<agent>/evals.json via the Agent tool, captures output, runs
  deterministic assertions, and writes a run report. Real Claude API cost —
  user-triggered only, never in CI.

  Use when: "run evals on test-designer", "verify the acceptance pipeline
  still works", "check agent behavior after a change", "rerun evals".
---

# wicked-testing-evals (dev skill)

Repo-local dev skill. Runs on demand against the agents in this repo.
Not shipped to npm; not part of the public contract.

## Workflow

### 1. List / plan

```bash
node scripts/dev/evals.mjs list
node scripts/dev/evals.mjs plan <agent>
```

The plan command prints cases, expected shapes, assertion counts, and a
rough cost estimate. Review before running.

### 2. Execute (dispatch from this skill)

This skill orchestrates the run. For each case in the chosen agent's
`evals.json`:

1. Create case directory: `.claude/skills/wicked-testing-evals/workspace/iteration-<N>/<agent>/case-<id>/`
2. Dispatch the agent via the Agent tool with:
   - `subagent_type` = `<data.subagent_type>` from evals.json
   - `prompt` = case `prompt`
   - Any files from `input_files` copied into the case directory as context
3. Capture:
   - Full agent output → `output.md`
   - Any artifacts the agent writes → folder tree preserved
   - Exit status → `exit.code`

**Cost discipline:**
- ≤ 5 cases: run without asking
- 6-10 cases: confirm once
- > 10 cases: confirm per-agent, or require `--yes`

### 3. Check assertions

```bash
node scripts/dev/evals.mjs check <agent> iteration-<N>
```

Prints per-case PASS/FAIL with per-assertion detail. Writes `report.json`
with the full result tree. Exits non-zero on any failure.

### 4. Iterate

If failures are real regressions, fix the agent or the schema.
If failures are flaky dispatches, rerun — each run gets a new iteration
number (N+1) so history is preserved.

## Assertion kinds (checked deterministically)

| Kind                | What it checks                                             |
|---------------------|------------------------------------------------------------|
| `produces-artifact` | A file matching the glob was written                       |
| `manifest-valid`    | `manifest.json` has required keys from evidence schema     |
| `verdict-in`        | Verdict value is one of the allowed set                    |
| `contains-text`     | Agent output contains a substring                          |
| `matches-regex`     | Agent output matches a regex                               |
| `exit-code-zero`    | Runner exit code was 0                                     |

## Adding evals for a new agent

1. Create `evals/<agent-name>/evals.json`
2. Follow the schema in `evals/README.md`
3. Start with 3 cases: happy / edge / malformed-input
4. Run and iterate until assertions stabilize

## Promotion path

When consumers ask for "run evals against my agents," promote this logic
from `.claude/skills/wicked-testing-evals/` to `skills/evals/` and bump
wicked-testing's minor version.

## References

- `scripts/dev/evals.mjs` — runner
- `evals/README.md` — eval-set format
- `evals/test-designer/evals.json` — pilot set
