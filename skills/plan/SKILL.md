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

## Output

- A test strategy: scenarios (positive + negative), risk matrix, testability
  verdict, AC quality verdict
- Concrete next actions: which scenarios to author next, which ACs to rewrite,
  which design changes unblock testing
- A pointer to the ledger where this plan is recorded

## Tier-2 specialists this skill may pull in

For specific domains, the skill can also dispatch domain specialists:
- UI-heavy change → ui-component-test-engineer (not contract surface)
- API change → integration-test-engineer
- Data migration → data-quality-tester
- Heavy compute → load-performance-engineer

Tier-2 names are not part of the public contract — see NAMESPACE.md.

## References

- [`docs/INTEGRATION.md`](../../docs/INTEGRATION.md)
- [`docs/NAMESPACE.md`](../../docs/NAMESPACE.md)
- `agents/test-strategist.md`, `agents/risk-assessor.md`,
  `agents/testability-reviewer.md`, `agents/requirements-quality-analyst.md`
