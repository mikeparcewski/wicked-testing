---
description: Run tests and capture evidence — dispatches the execution skill
argument-hint: "[target] [--project <name>] [--suite] [--json]"
---

# /wicked-testing:execution

Execute a scenario or test suite, capture evidence, and write a run + verdict
to the ledger.

## Usage

```
/wicked-testing:execution [target] [--project <name>] [--suite] [--json]
```

- `target` — scenario file path, scenario name, or a test command
- `--project` — associate the run with a named project
- `--suite` — run the project's full test suite instead of a scenario
- `--json` — emit JSON envelope

## Instructions

Invoke the **wicked-testing:execution** skill. The skill dispatches to
`scenario-executor`, `test-designer` (full loop), or
`acceptance-test-executor` depending on input.

## Evidence

Every run creates `.wicked-testing/evidence/<run-id>/manifest.json` per
[docs/EVIDENCE.md](../docs/EVIDENCE.md). Bus events emitted when present:
`wicked.testrun.started`, `wicked.testrun.finished`,
`wicked.evidence.captured`, `wicked.verdict.recorded`.

Output: run_id, verdict, evidence path. One line.

## References

- [Execution skill](../skills/execution/SKILL.md)
- [Evidence layout](../docs/EVIDENCE.md)
