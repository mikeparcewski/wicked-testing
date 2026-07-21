---
name: REQ-005-dod-criteria
title: wicked-testing — Definition of Done Criteria
status: draft
version: 0.1
date: 2026-07-21
author: mike.parcewski@gmail.com
review-required: true
---

# REQ-005 — Definition of Done Criteria

## Overview

Three levels of DoD gate the release of any wicked-testing version. Level 1
is the minimum bar for any merge to main. Level 2 is required for a release
candidate. Level 3 is required to tag and publish to npm.

---

## Level 1 — Build and Structural Integrity

These criteria must pass on every PR and every merge to main.

| # | Criterion | How Verified |
|---|---|---|
| L1-1 | All 48 skills are present under `skills/` | `ls skills/ | wc -l` = 48 |
| L1-2 | All 8 workflow skills are present | Manifest check in `prepublishOnly` |
| L1-3 | All 15 Tier-1 specialist skills are present | Manifest check in `prepublishOnly` |
| L1-4 | Unit tests pass | `npm test` exits 0 |
| L1-5 | `npm run prepublishOnly` exits 0 | CI `ci.yml` |
| L1-6 | No ad-hoc SQL in any file (no string-concatenated SQL) | Code review + `grep` check |
| L1-7 | All specialist skills carry `context: fork` in frontmatter | Automated scan or code review |
| L1-8 | `schemas/evidence.json` passes JSON Schema meta-validation | `manifest.test.mjs` |
| L1-9 | Migration scripts are numbered sequentially with no gaps | `migrate.test.mjs` |

---

## Level 2 — Pipeline and Integration Integrity

Required for a release candidate. Validates that the product's runtime
behavior matches specification.

| # | Criterion | How Verified |
|---|---|---|
| L2-1 | 3-agent acceptance pipeline completes on `scenarios/test-runner.md` | `npx wicked-testing doctor` or manual run |
| L2-2 | Verdict `PASS` or `FAIL` is persisted in both JSON and SQLite | Inspect `verdicts/*.json` + `SELECT * FROM verdicts` |
| L2-3 | Evidence manifest written at correct path and validates against schema | `manifest.test.mjs` + file inspection |
| L2-4 | Reviewer receives no executor context (cold read verified) | Acceptance pipeline log inspection |
| L2-5 | wicked-bus events emitted in correct order on a run | `bus-emit.test.mjs` + integration smoke test |
| L2-6 | SQLite degrades to JSON-only cleanly when `better-sqlite3` fails to load | `domain-store.test.mjs` mock path |
| L2-7 | Oracle returns results for all 13 named queries | `oracle-queries.test.mjs` |
| L2-8 | Install is idempotent — re-running `npx wicked-testing install` on same target exits 0 | Manual or CI test |
| L2-9 | `wicked-testing:insight` answers a plain-English query via parameterized SQL | Integration smoke test |
| L2-10 | Dual-write order: JSON written before SQLite row on `create()` | `domain-store.test.mjs` |

---

## Level 3 — Release Gate

Required to tag and publish to npm. The product must use itself to reach this
gate.

| # | Criterion | How Verified |
|---|---|---|
| L3-1 | wicked-testing runs its own `acceptance-testing` pipeline against itself and produces a `PASS` verdict | Evidence manifest in `.wicked-testing/evidence/` with `verdict: PASS` |
| L3-2 | The self-test verdict is recorded in the DomainStore (JSON + SQLite) | `wicked-testing:insight "show bootstrap verdict"` returns PASS |
| L3-3 | Adversarial review PASS — at least one external reviewer (human or council) has signed off the release | Entry in `.product/reviews/` |
| L3-4 | `CHANGELOG.md` entry exists for the release version | File inspection |
| L3-5 | `npm publish --access public` exits 0 and the package is visible on npm | Post-publish `npm view wicked-testing version` |
| L3-6 | `npx wicked-testing install` from the freshly published version installs cleanly on a clean environment | CI `release.yml` smoke step |
| L3-7 | No known open P0 or P1 bugs in the issue tracker | Manual check before tag |

---

## Notes

- Level 1 criteria are enforced automatically by CI. A failing L1 criterion
  blocks merge.
- Level 2 criteria require a successful pipeline run. The `evals.yml` workflow
  runs the scenario-driven eval suite on push to main.
- Level 3 is a manual gate: a human or crew session must confirm all criteria
  before the release tag is pushed.
