---
name: wicked-testing:authoring
description: |
  Tier-1 orchestrator for producing tests. Writes scenario files, generates
  test code (unit / integration / E2E), creates fixtures and test data. The
  "make me tests" skill.

  Use when: "write tests", "generate test code", "author scenarios", "create
  a scenario file", "add fixtures", "test data setup", "automate this scenario".
---

# wicked-testing:authoring

Turns a plan or a diff into runnable tests. Two modes: scenario authoring
(markdown files the executor runs later) and test code generation (pytest /
jest / etc. that runs in CI).

## When to use

- You have a strategy from `wicked-testing:plan` and need the actual tests
- You're mid-build and need unit / integration tests for the last change
- You need to convert an existing scenario into framework-specific code
- You need fixtures or anonymized sample data

## How it dispatches

| Input                                   | Dispatch                                     |
|-----------------------------------------|----------------------------------------------|
| "write scenarios" / plan in hand        | `wicked-testing:test-strategist` then scenario authoring flow |
| "generate jest tests" / "add pytest"    | `wicked-testing:test-automation-engineer`    |
| "author an acceptance test plan"        | `wicked-testing:acceptance-test-writer`      |
| "build fixtures" / "need test data"     | Tier-2: test-data-manager                    |
| Contract work (OpenAPI, Pact)           | `wicked-testing:contract-testing-engineer`   |

Scenario files use the format in [`SCENARIO-FORMAT.md`](../../SCENARIO-FORMAT.md).

## Output

- A scenario file (markdown) in `scenarios/`, OR
- Test code in the project's test directory matching the project's framework,
  OR
- Both, when authoring scenarios that have automated companions

Emits `wicked.scenario.authored` and/or `wicked.teststrategy.authored` on the
bus when present.

## References

- [`docs/INTEGRATION.md`](../../docs/INTEGRATION.md)
- [`SCENARIO-FORMAT.md`](../../SCENARIO-FORMAT.md)
- `agents/test-automation-engineer.md`, `agents/acceptance-test-writer.md`,
  `agents/contract-testing-engineer.md`
