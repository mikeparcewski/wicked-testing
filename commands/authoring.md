---
description: Author scenarios and generate test code — dispatches the authoring skill
argument-hint: "[target] [--framework jest|pytest|playwright|...] [--scenario] [--code]"
---

# /wicked-testing:authoring

Turn a plan or a diff into runnable tests. Authors scenario files (markdown
the executor runs) and/or test code for your project's framework.

## Usage

```
/wicked-testing:authoring [target] [--framework <name>] [--scenario] [--code]
```

- `target` — file path, feature description, or scenario name
- `--framework` — force a specific framework (autodetected otherwise)
- `--scenario` — produce a scenario file only
- `--code` — produce test code only (both if neither flag is passed)

## Instructions

Invoke the **wicked-testing:authoring** skill. The skill decides whether to
route to `test-strategist`, `test-automation-engineer`,
`acceptance-test-writer`, or `contract-testing-engineer` based on the target.

- For a feature description → scenarios (positive + negative) + matching test
  code if `--code` is given
- For an OpenAPI spec or a service boundary → contract tests
- For a diff → tests for the changed lines

Output: the scenario path + test file path, plus a one-line summary.
Emits `wicked.scenario.authored` on the bus when present.

## References

- [Authoring skill](../skills/authoring/SKILL.md)
- [Scenario format](../SCENARIO-FORMAT.md)
