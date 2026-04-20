---
description: Produce an independent verdict — dispatches the review skill
argument-hint: "[run-id | path] [--spec <path>] [--focus semantic|quality|testability]"
---

# /wicked-testing:review

Render an independent verdict on captured evidence, check spec-to-code
alignment, or audit test quality. Reviewers work from evidence, not from
the executor's narration.

## Usage

```
/wicked-testing:review [run-id | path] [--spec <path>] [--focus <area>]
```

- `run-id` — review a specific recorded run
- `path` — review a source tree or test directory
- `--spec` — path to the acceptance criteria / spec document
- `--focus` — `semantic` (spec alignment) | `quality` (test quality audit) |
  `testability` (code testability review)

## Instructions

Invoke the **wicked-testing:review** skill. Routes to:
- `acceptance-test-reviewer` — verdict from evidence manifest
- `semantic-reviewer` — spec-to-code Gap Report
- `code-analyzer` — static testability + quality signals
- `production-quality-engineer` — post-deploy quality read
- `continuous-quality-monitor` — live build-phase signals

## Output

Verdict (PASS / FAIL / N-A / SKIP / CONDITIONAL), reason, and the next
actions. Emits `wicked.verdict.recorded` on the bus when present.

## References

- [Review skill](../skills/review/SKILL.md)
- [Integration contract](../docs/INTEGRATION.md)
