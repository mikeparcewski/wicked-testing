---
name: wicked-testing:plan
description: |
  Tier-1 orchestrator for test planning. Covers test strategy, risk, testability
  review, and requirements quality. Dispatches specialist agents based on what
  the target needs.

  Use when: "what should I test", "test strategy", "test plan", "risk matrix",
  "is this testable", "are these requirements testable", "coverage strategy",
  "shift-left testing".
---

# wicked-testing:plan

One skill for everything before tests get written. Figures out what to test,
what can go wrong, and whether the design lets you test at all.

## When to use

- Before the build phase of a feature
- When a PR's scope is unclear and you need to know what to test
- When acceptance criteria were just drafted (requirements-quality gate)
- When a design doc is ready but no code exists yet (testability gate)

## How it dispatches

Read the target first, then route:

| Target                                     | Dispatch                                          |
|--------------------------------------------|---------------------------------------------------|
| Acceptance criteria / clarify doc          | `wicked-testing:requirements-quality-analyst`     |
| Design doc / architecture sketch           | `wicked-testing:testability-reviewer`             |
| Feature description / user story           | `wicked-testing:test-strategist`                  |
| Known-risky change (security, data, perf)  | `wicked-testing:risk-assessor`                    |
| "Test everything" / broad review           | All four in parallel; merge findings              |

When multiple apply, dispatch in parallel. Merge results in the reply — no
unrelated raw outputs dumped in.

### Dispatch block (executable)

```
Task(
  subagent_type="wicked-testing:test-strategist",
  prompt="""Generate a comprehensive test strategy for the target below.

## Target
{file path, directory, or feature description}

## Instructions
1. Classify the change type (UI, API, both, data, config).
2. Analyze the surface area (public APIs, functions, endpoints).
3. Generate positive + negative scenario pairs for every feature.
4. Identify risk areas and confidence level.
5. Flag any specification gaps discovered.

**MANDATORY**: Every scenario must have BOTH positive AND negative counterpart.
Return findings in the standard test-strategist format."""
)
```

Swap `subagent_type` to the matching agent from the table above. For the
"test everything" path, dispatch all four in parallel (one `Task(...)` call
per agent in the same turn) and merge the returned findings.

## Tier-2 specialists this skill may pull in

For domain-specific planning signals, dispatch a specialist and fold its
output into the strategy document. These don't render verdicts — they add
risk+scenario coverage where the generalist agents would miss signal:

| Trigger (anything in the target that matches)            | Specialist                              |
|----------------------------------------------------------|-----------------------------------------|
| React/Vue/Svelte component under test                    | `wicked-testing:ui-component-test-engineer` |
| API / service boundary (REST, gRPC, GraphQL)             | `wicked-testing:integration-test-engineer`  |
| Database migration or schema change                      | `wicked-testing:data-quality-tester`        |
| Performance-sensitive path (heavy compute, I/O)          | `wicked-testing:load-performance-engineer`  |
| Multi-step user journey                                  | `wicked-testing:e2e-orchestrator`           |
| UI with visual regressions risk (CSS, theming)           | `wicked-testing:visual-regression-engineer` |
| User-facing surface (WCAG 2.1 AA relevance)              | `wicked-testing:a11y-test-engineer`         |
| Parser / serializer / round-trip / invariants            | `wicked-testing:fuzz-property-engineer`     |
| Translated / RTL / pluralization-sensitive copy          | `wicked-testing:localization-test-engineer` |
| Service with logs / metrics / traces / PII-in-signals    | `wicked-testing:observability-test-engineer` |
| Test-suite effectiveness evaluation (kill rate)          | `wicked-testing:mutation-test-engineer`     |
| Failure-mode / resilience planning                       | `wicked-testing:chaos-test-engineer`        |

Tier-2 names are internal — see [docs/NAMESPACE.md](../../docs/NAMESPACE.md).
Consumers (wicked-garden) depend only on Tier-1 names.

## Output

- A test strategy: scenarios (positive + negative), risk matrix, testability
  verdict, AC quality verdict
- Concrete next actions: which scenarios to author next, which ACs to rewrite,
  which design changes unblock testing
- A pointer to the ledger where this plan is recorded

Emits `wicked.teststrategy.authored` on the bus when present.

## References

- [`docs/INTEGRATION.md`](../../docs/INTEGRATION.md)
- [`docs/NAMESPACE.md`](../../docs/NAMESPACE.md)
- `agents/test-strategist.md`, `agents/risk-assessor.md`,
  `agents/testability-reviewer.md`, `agents/requirements-quality-analyst.md`
