---
name: TEST-001-test-strategy
title: wicked-testing — Test Strategy
status: draft
version: 0.1
date: 2026-07-21
author: mike.parcewski@gmail.com
review-required: true
---

# TEST-001 — Test Strategy

## Guiding Principle

wicked-testing is its own QE customer. The same acceptance pipeline the
product provides to users is used to gate wicked-testing releases. The product
must be capable of producing a `PASS` verdict on itself before a release tag
is pushed.

---

## Test Levels

### Level 1 — Unit Tests

**Location**: `tests/unit/`
**Runner**: Node.js built-in test runner (`node --test`)
**Command**: `npm test` or `npm run test:unit`

Unit tests cover the library layer (not the skills). Each test file targets
one module:

| File | Module Under Test |
|---|---|
| `domain-store.test.mjs` | `lib/domain-store.mjs` — CRUD, dual-write, degradation |
| `oracle-queries.test.mjs` | `lib/oracle-queries.mjs` — query routing, parameterization |
| `migrate.test.mjs` | `lib/migrate.mjs` — migration application, schema versioning |
| `manifest.test.mjs` | Evidence manifest generation and schema validation |
| `bus-emit.test.mjs` | `lib/bus-emit.mjs` — fire-and-forget emission, no-op when bus absent |
| `context-md-validator.test.mjs` | Cold-context injection safety (non-prejudicial content check) |

Unit tests run on every push via `ci.yml`. They must pass before any merge
to main.

---

### Level 2 — Scenario-Driven Acceptance Tests (Evals)

**Location**: `scenarios/` and `evals/`
**Runner**: wicked-testing's own acceptance pipeline (3-agent: writer →
executor → reviewer)
**Commands**: `npm run evals:list`, `npm run evals:plan`, `npm run evals:summary`
**CI**: `.github/workflows/evals.yml`

Evals exercise the full product pipeline end-to-end. Each eval is a scenario
file that describes a behavior the product must exhibit:

- `scenarios/test-runner.md` — bootstrap self-test: verifies the DomainStore
  can be initialized, a full acceptance run can be recorded, and the oracle
  can query the verdict.
- `scenarios/examples/` — illustrative scenarios that double as regression
  tests for the scenario format parser.

The eval suite is run on every push to main. A failing eval blocks the release
candidate.

---

### Level 3 — Self-Hosting Gate (Release Only)

Before any npm publish, the product must pass its own acceptance pipeline on
itself. The criterion:

1. `/wicked-testing:acceptance-testing scenarios/test-runner.md` produces a
   `PASS` verdict.
2. The verdict is recorded in both JSON (`verdicts/*.json`) and SQLite.
3. `/wicked-testing:insight "show bootstrap verdict"` returns `PASS`.

This is the wicked-testing equivalent of "eating your own dog food." The
self-hosting gate is a manual step (or a gated CI step in `release.yml`)
before the release tag is pushed.

---

## CI Workflows

| Workflow | Trigger | What It Runs |
|---|---|---|
| `ci.yml` | Every push and PR | `npm test` (unit tests) + `prepublishOnly` |
| `evals.yml` | Every push to main + manual dispatch | Scenario-driven eval suite |
| `release.yml` | Tag push matching `v*.*.*` | npm publish + post-publish smoke test |
| `pages.yml` | Push to main | Site build and deploy to GitHub Pages (wt.wickedagile.com) |

---

## Test Data

Test data for unit tests is in-memory or in a temporary directory created and
torn down per test. No shared state between unit tests. The
`domain-store.test.mjs` suite uses a temp dir for JSON files and an in-memory
SQLite database (`:memory:`) to avoid file-system coupling.

Eval scenarios reference example files in `scenarios/examples/`. These are
committed to the repository and version-controlled.

---

## Oracle and SQL Audit

Because `test-oracle` uses fixed parameterized queries, its correctness is
verified by:

1. `oracle-queries.test.mjs` — exercises all 13 named queries against a seeded
   in-memory database and asserts on the returned rows.
2. Code review — no dynamic SQL concatenation is permitted; `grep` checks for
   string concatenation patterns around SQL keywords.

---

## Defect Triage

| Severity | Description | Action |
|---|---|---|
| P0 | Verdict can be falsified (self-grading failure) | Immediate fix; no release |
| P0 | Evidence manifest written with wrong `verdict` field | Immediate fix; no release |
| P1 | Acceptance pipeline crashes on a valid scenario | Fix before release candidate |
| P1 | Unit test failure on main | Fix before merge |
| P2 | Degraded mode (JSON-only) produces incorrect results | Fix in next minor version |
| P3 | wicked-bus event emitted in wrong order | Fix in next minor version |

---

## Isolation Verification

Reviewer isolation (`allowed-tools: [Read]`, `context: fork`) is the product's
primary integrity claim. The following checks are in scope for every release:

1. The `acceptance-test-reviewer` skill's frontmatter carries `allowed-tools:
   [Read]` and `context: fork`.
2. The orchestrator never passes executor stdout or context directly to the
   Reviewer invocation.
3. `context.md`, if written, contains only domain knowledge; `context-md-
   validator.test.mjs` asserts that run-specific content is rejected.

These checks are currently code-review + unit-test enforced. A future version
may add a runtime assertion that the Reviewer's input is strictly bounded to
the evidence directory path.
