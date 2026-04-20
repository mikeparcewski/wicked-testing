---
name: wicked-testing:review
description: |
  Tier-1 orchestrator for judgment. Renders independent verdicts on captured
  evidence, checks spec-to-code alignment, audits test quality, and reviews
  code for testability signals.

  Use when: "review this", "judge the evidence", "verdict", "does the code
  match the spec", "is this test suite any good", "code review for testability".
---

# wicked-testing:review

Reviewing is its own discipline. This skill is the place where verdicts are
rendered — not inside the executor, not as a side effect of running.

## When to use

- A run just finished and needs an independent verdict
- Post-implementation: does the code actually match the spec?
- The test suite itself needs a quality pass
- A code review needs a testability-focused perspective

## How it dispatches

| Input                                                      | Dispatch                                     |
|------------------------------------------------------------|----------------------------------------------|
| A run's evidence manifest                                  | `wicked-testing:acceptance-test-reviewer`    |
| Spec + implementation                                      | `wicked-testing:semantic-reviewer`           |
| Test suite path                                            | `wicked-testing:code-analyzer` + Tier-2      |
| Production metrics, post-deploy                            | `wicked-testing:production-quality-engineer` |
| Active build, quality signals                              | `wicked-testing:continuous-quality-monitor`  |

## Independence

Reviewers work from evidence and spec, not from the executor's story.
`acceptance-test-reviewer` is isolated (Read-only tools) to keep its verdict
honest. Do not pre-narrate what it should find.

## Verdict semantics

- `PASS` — evidence + spec agree, tests exercise what was changed
- `FAIL` — assertion unsatisfied, evidence contradicts, or spec-code divergence
- `N-A` — reviewable item doesn't apply (must be justified)
- `SKIP` — applicable but deferred (ticket required)
- `CONDITIONAL` — approve with listed fixes before ship

## Output

- Verdict + reason
- Evidence citations (file paths, line numbers, AC IDs)
- Next actions: specific, assignable, bounded

Emits `wicked.verdict.recorded` on the bus when present.

## References

- [`docs/INTEGRATION.md`](../../docs/INTEGRATION.md)
- [`docs/EVIDENCE.md`](../../docs/EVIDENCE.md)
- `agents/acceptance-test-reviewer.md`, `agents/semantic-reviewer.md`,
  `agents/code-analyzer.md`, `agents/continuous-quality-monitor.md`,
  `agents/production-quality-engineer.md`
