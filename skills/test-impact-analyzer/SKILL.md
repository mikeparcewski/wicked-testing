---
name: wicked-testing:test-impact-analyzer
context: fork
description: |
  Tier-2 specialist — answers "given this diff, which tests must I run?"
  Consumes git diff, call-graph signal, and historical coverage from the
  DomainStore ledger to rank existing scenarios by probability of catching
  a regression in the change. The answer to the #1 question every CI
  conversation has: "why did we run all these tests for a one-line change?"

  Use when: test impact analysis, TIA, selective testing, "which tests
  should I run", "affected tests for this diff", CI test selection, PR-scoped
  test runs, smart test selection.

  <example>
  Context: A PR touched lib/domain-store.mjs and skills/acceptance-test-reviewer/SKILL.md.
  user: "Which tests are affected by this diff?"
  <commentary>Use test-impact-analyzer — it grepped the diff, ran
  call-graph discovery to find dependent scenarios, queried the ledger for
  historical coverage, and ranked the top 20 affected scenarios by
  impact × exposure.</commentary>
  </example>
---

# Test Impact Analyzer

Answers "which tests catch this diff?" with evidence. Does not run tests —
ranks the existing scenario set so a CI system or a developer can run the
top N with high confidence that a regression in the diff will be caught.

## Inputs

- **Diff reference** — defaults to `main`; accepts `HEAD~N`, branch name, or SHA
- **Scenario registry** — all active scenarios from DomainStore (project-scoped)
- **Coverage history** — per-scenario evidence files from recent passing runs (best-effort)
- **Call-graph** — `tree-sitter` / `ast-grep` / language server if on PATH; falls back to path-prefix matching

## Scoring

Each scenario gets a score in `[0, 1]`:
`0.50 × direct_file_overlap + 0.25 × call_graph_reach + 0.15 × path_prefix_similarity + 0.10 × recent_flake_penalty`.
Weights tunable via `.wicked-testing/config.json`'s `tia.weights`.

## Output

Evidence dir: `changed-files.txt`, `diff-stat.txt`, `impact-ranking.json` (ranked scenarios with score + reasons),
`impact-summary.md` (top N + tail), `impact-coverage-gap.md` (files in diff with no scenario coverage).

DomainStore: one `tasks` row with the ranked list for `/wicked-testing:insight`.
Bus: `wicked.testimpact.computed`. No `verdicts` row — TIA is advisory, not an adjudication.

## Failure modes

- `ERR_EMPTY_DIFF` — no changes vs the ref (exit 3)
- `ERR_NO_SCENARIOS` — no active scenarios in ledger; author them first
- `ERR_INSUFFICIENT_SIGNAL` — neither git nor ledger is readable (exit 3)
- Stale coverage (> 90 days) → confidence: "low"; path-prefix similarity is the fallback

## Integration

- `/wicked-testing:execution --selective --since <ref>` dispatches this skill, reads `impact-ranking.json`, and runs the top-N (default 40)
- `--selective-confidence-floor 0.3` filters by score
- Bash scoped to `git`, `sqlite3`, and optional call-graph tools only

## References

- [`lib/domain-store.mjs`](../../lib/domain-store.mjs)
- [`lib/oracle-queries.mjs`](../../lib/oracle-queries.mjs)
- [`skills/execution/SKILL.md`](../../skills/execution/SKILL.md)
- [`skills/coverage-archaeologist/SKILL.md`](./coverage-archaeologist.md)
