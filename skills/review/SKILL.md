---
name: wicked-testing:review
description: |
  Tier-1 orchestrator for judgment. Renders independent verdicts on captured
  evidence, checks spec-to-code alignment, audits test quality, and reviews
  code for testability signals.

  Use when: "review this", "judge the evidence", "verdict", "does the code
  match the spec", "is this test suite any good", "code review for testability",
  "/wicked-testing:review".
argument-hint: "[run-id | path] [--spec <path>] [--focus semantic|quality|testability]"
---

# wicked-testing:review

Reviewing is its own discipline. This skill is the place where verdicts are
rendered — not inside the executor, not as a side effect of running.

## Usage

```
/wicked-testing:review [run-id | path] [--spec <path>] [--focus <area>]
```

Arguments map onto the dispatch table below:

- `run-id` — review a specific recorded run: `acceptance-test-reviewer` over
  the run's evidence manifest
- `path` — review a source tree or test directory
- `--spec <path>` — supplies the acceptance criteria / spec document
- `--focus semantic` — spec-to-code alignment: `semantic-reviewer` Gap Report
- `--focus quality` — test quality audit: `code-analyzer` + the
  test-code-quality Tier-2 specialist
- `--focus testability` — code testability review: `code-analyzer` static
  review

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

### Dispatch block (executable)

Every id in the tables above is a forked worker skill (`context: fork`) —
invoke it with the Skill tool so it runs in an isolated context. For the
reviewer this is isolation-critical: the forked context is what guarantees
it never sees the executor's history.

```
Skill(
  skill="wicked-testing:acceptance-test-reviewer",
  args="""Review the evidence manifest at the path below and render an
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

For a spec-vs-code divergence review, swap the `skill` id to
`wicked-testing:semantic-reviewer` and pass the spec path + implementation
path. For a standalone test-suite quality review (no run, just the source),
dispatch `code-analyzer` + the relevant Tier-2 specialist from the table below.

## Independence

Reviewers work from evidence and spec, not from the executor's story.
`acceptance-test-reviewer` is isolated (Read-only tools, `context: fork`
forked invocation, scrubbed `context.md` via `lib/context-md-validator.mjs`)
to keep its verdict honest. Do not pre-narrate what it should find.

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
| Audit test-suite quality (smells, dead tests)          | `wicked-testing:test-code-quality-auditor`  |
| Audit snapshot hygiene (stale, over-broad, dead)       | `wicked-testing:snapshot-hygiene-auditor`   |
| Release gate — GO / CONDITIONAL / NO-GO                | `wicked-testing:release-readiness-engineer` |
| Compliance evidence review (SOC2 / HIPAA / GDPR)       | `wicked-testing:compliance-test-engineer`   |

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
- `skills/acceptance-test-reviewer/SKILL.md`, `skills/semantic-reviewer/SKILL.md`,
  `skills/code-analyzer/SKILL.md`, `skills/production-quality-engineer/SKILL.md`
