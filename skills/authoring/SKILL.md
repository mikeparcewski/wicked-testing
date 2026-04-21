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

| Input                                                | Dispatch                                     |
|------------------------------------------------------|----------------------------------------------|
| "write scenarios" / plan in hand                     | `wicked-testing:test-strategist` → scenario authoring flow |
| "generate jest tests" / "add pytest"                 | `wicked-testing:test-automation-engineer`    |
| "author an acceptance test plan" (3-agent pipeline)  | `wicked-testing:acceptance-test-writer`      |
| "build fixtures" / "need test data"                  | `wicked-testing:test-data-manager`           |
| Contract work (OpenAPI, Pact, gRPC, GraphQL)         | `wicked-testing:contract-testing-engineer`   |

### Dispatch block (executable)

```
Task(
  subagent_type="wicked-testing:test-automation-engineer",
  prompt="""Generate tests for the target below in the project's detected
framework.

## Target
{file path or feature description}

## Scope
- {--scenario only | --code only | both}
- Framework: {jest | pytest | playwright | vitest | go test | ... | detect from project}

## Instructions
1. Detect the project's test framework if not specified (presence of
   `vitest.config.*`, `jest.config.*`, `pyproject.toml` with pytest, etc.).
2. For every public function / endpoint / component in scope, produce a test
   that exercises a happy path AND at least one negative / edge case.
3. Use existing fixtures where present; don't hand-roll test data if the
   project has factories.
4. Follow the project's file-layout convention (co-located vs `tests/`).

Return the path(s) written and a one-line per-file summary."""
)
```

Specialized dispatches swap `subagent_type` for the right agent (see the
table above). For an OpenAPI spec, use `contract-testing-engineer`; for the
3-agent acceptance pipeline's test-plan phase, use `acceptance-test-writer`.

## Tier-2 specialists this skill routes to

For domain-specific test authoring, dispatch the matching specialist. Each
returns test code and/or scenarios in its domain — do not merge their output
verbatim; fold it into the authoring reply:

| Trigger                                              | Specialist                                  |
|------------------------------------------------------|---------------------------------------------|
| Component test (React Testing Library etc.)          | `wicked-testing:ui-component-test-engineer` |
| Service-integration test (testcontainers, compose)   | `wicked-testing:integration-test-engineer`  |
| Full user-journey Playwright test                    | `wicked-testing:e2e-orchestrator`           |
| Visual-regression baseline (Playwright + pixelmatch) | `wicked-testing:visual-regression-engineer` |
| Accessibility test (axe-core / pa11y)                | `wicked-testing:a11y-test-engineer`         |
| Load / perf test (k6 / locust / hey)                 | `wicked-testing:load-performance-engineer`  |
| Property-based / round-trip test                     | `wicked-testing:fuzz-property-engineer`     |
| Pseudolocalization / RTL / CLDR plural test          | `wicked-testing:localization-test-engineer` |
| Log / metric / trace assertion test                  | `wicked-testing:observability-test-engineer` |
| Data migration forward+rollback test                 | `wicked-testing:data-quality-tester`        |

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
