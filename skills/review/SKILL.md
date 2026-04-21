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
| Spec + implementation (post-code divergence)               | `wicked-testing:semantic-reviewer`           |
| Test suite path                                            | `wicked-testing:code-analyzer` + Tier-2      |
| Production metrics, post-deploy                            | `wicked-testing:production-quality-engineer` |
| Active build, quality signals                              | `wicked-testing:continuous-quality-monitor`  |

### Dispatch block (executable)

```
Task(
  subagent_type="wicked-testing:acceptance-test-reviewer",
  prompt="""Review the evidence manifest at the path below and render an
independent verdict.

## Evidence Directory
.wicked-testing/evidence/{RUN_ID}/

## Scenario Path
{path — read it yourself}

## Instructions
1. Read the scenario file.
2. Read the test plan from the evidence dir.
3. Read evidence files in the evidence dir (step-N.json, artifacts, optional
   context.md). Do NOT use any other context — you never saw the execution.
4. For each assertion, evaluate evidence → verdict (PASS / FAIL / INCONCLUSIVE).
5. If context.md is present, treat it as pre-vetted cold knowledge. If it
   contains a prior verdict, run_id, historical counts, or executor
   reasoning, flag as CONTEXT_CONTAMINATION and return INCONCLUSIVE.

Return the verdict, reasoning per assertion, and next actions.
DO NOT reference executor conversation context beyond the files above."""
)
```

For a spec-vs-code divergence review, swap to `semantic-reviewer` and pass
the spec path + implementation path. For a standalone test-suite quality
review (no run, just the source), dispatch `code-analyzer` + the relevant
Tier-2 specialist from the table below.

## Independence

Reviewers work from evidence and spec, not from the executor's story.
`acceptance-test-reviewer` is isolated (Read-only tools, scrubbed `context.md`
via `lib/context-md-validator.mjs`) to keep its verdict honest. Do not
pre-narrate what it should find.

## Tier-2 specialists this skill routes to

For domain-specific reviews, dispatch the specialist. Each returns a verdict
or a list of findings the skill folds into the review output:

| Trigger                                                | Specialist                                  |
|--------------------------------------------------------|---------------------------------------------|
| "Is this test suite effective?" (mutation kill rate)   | `wicked-testing:mutation-test-engineer`     |
| "Did this suite exercise WCAG surfaces?"               | `wicked-testing:a11y-test-engineer`         |
| Translated-copy review (pseudoloc, RTL, pluralization) | `wicked-testing:localization-test-engineer` |
| Observability-assertion review (logs / traces / PII)   | `wicked-testing:observability-test-engineer` |
| Flake detection for a scenario's history               | `wicked-testing:flaky-test-hunter`          |
| Untested-path audit                                    | `wicked-testing:coverage-archaeologist`     |
| "Does this meet contract?" (Pact / OpenAPI)            | `wicked-testing:contract-testing-engineer`  |

## Verdict semantics

- `PASS` — evidence + spec agree, tests exercise what was changed
- `FAIL` — assertion unsatisfied, evidence contradicts, or spec-code divergence
- `N-A` — reviewable item doesn't apply (must be justified)
- `SKIP` — applicable but deferred (ticket required)
- `CONDITIONAL` — approve with listed fixes before ship
- `INCONCLUSIVE` — evidence missing OR context contaminated

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
