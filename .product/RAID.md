---
name: RAID
title: wicked-testing — RAID Log
status: draft
version: 0.1
date: 2026-07-21
author: mike.parcewski@gmail.com
review-required: false
---

# RAID — Risks, Assumptions, Issues, Dependencies

---

## Risks

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-001 | Forked contexts on non-Claude CLIs do not enforce `allowed-tools`, degrading Reviewer isolation | High | High | Document advisory status in README and install output; hard-enforcement is only guaranteed on Claude Code. Consumers who require strong isolation must use Claude Code. |
| R-002 | `better-sqlite3` pre-built binary is unavailable for a target platform (e.g. Alpine Linux musl, exotic arm) | Low | Medium | `npm install` falls back to `node-gyp rebuild`. Requires a C++ toolchain. If node-gyp also fails, the store degrades to JSON-only. Document this in REQ-002 and README. |
| R-003 | Evidence manifest schema evolves in a breaking way, breaking downstream consumers that have pinned to `schemas/evidence.json` | Low | High | Schema is versioned. Breaking changes require a major semver bump and a migration note in `docs/EVIDENCE.md`. Non-breaking additions are additive and safe. |
| R-004 | Reviewer skill receives prejudicial context via `context.md` (a contaminated cold-context injection) | Low | High | Reviewer detects prejudicial content heuristically and returns `INCONCLUSIVE / CONTEXT_CONTAMINATION` rather than a false PASS. The orchestrator is responsible for writing only non-prejudicial domain knowledge to `context.md`. |
| R-005 | wicked-bus spawn failure causes silent data loss (events not emitted) | Medium | Low | Emission is fire-and-forget. A single debug line is printed to stderr. wicked-testing never blocks on bus emission. Consumers must tolerate at-most-once event delivery from wicked-testing. |
| R-006 | SQLite WAL file grows unboundedly on long-running projects | Low | Medium | WAL checkpointing is not currently managed automatically. Operators can run `PRAGMA wal_checkpoint` or `rebuildIndex()` periodically. Future versions may add automatic checkpointing. |
| R-007 | The `fdatasync` call in dual-write is not available on all platforms (wrapped in try/catch) | Medium | Low | Durability is best-effort. On platforms without `fdatasync`, the rename is still atomic at the OS level. JSON files are the canonical store; SQLite is the index. JSON loss is not silently masked. |

---

## Assumptions

| ID | Assumption |
|---|---|
| A-001 | The AI CLI harness is responsible for skill dispatch, context isolation, and tool enforcement. wicked-testing provides the skills; it does not implement the harness. |
| A-002 | The project root (where `.wicked-testing/` is created) is writable by the user running the CLI. No elevated permissions are assumed. |
| A-003 | Scenario files are authored by humans or by `test-designer`/`test-automation-engineer`. The acceptance pipeline validates scenarios; it does not generate them. |
| A-004 | wicked-bus, if used, is at-least-once delivery. wicked-testing does not implement deduplication on the producer side. |
| A-005 | The host CLI version supports `context: fork` in skill frontmatter. Older CLI versions that ignore this field will run specialists in the parent context, degrading isolation. |
| A-006 | `better-sqlite3` is loaded at runtime from the install location; it is not bundled into the skill files themselves. Skills access the DomainStore via `lib/domain-store.mjs`, which is resolved relative to the npm package root. |
| A-007 | Node.js ≥ 20 is present in the CLI's execution environment (not necessarily the system PATH — some CLIs embed their own Node runtime). |

---

## Issues

| ID | Issue | Status | Notes |
|---|---|---|---|
| I-001 | `wicked-qe` rename pending — `wicked-qe` bin alias ships but the package name and dir are still `wicked-testing` | Open | Rename tracked separately; bin alias is a bridge |
| I-002 | Oracle query count discrepancy: README says 12 named queries; DATA-DOMAIN.md says 13 | Open | DATA-DOMAIN.md is more recent; verify against `lib/oracle-queries.mjs` and reconcile |
| I-003 | Reviewer isolation on OpenCode and Pi relies on TypeScript plugin hooks, not frontmatter enforcement; isolation strength is not verified end-to-end on those CLIs | Open | Test coverage gap; advisory isolation noted in README |

---

## Dependencies

| ID | Dependency | Type | Required / Optional | Notes |
|---|---|---|---|---|
| D-001 | Node.js ≥ 20 | Runtime | Required | Must be present in the CLI's execution environment |
| D-002 | better-sqlite3 | npm (bundled) | Required (with fallback) | Pre-built binaries or node-gyp; store degrades to JSON-only if absent |
| D-003 | wicked-vault | npm peer | Required for cryptographic evidence signing | Absence degrades evidence to unsigned JSON; pipeline does not fail |
| D-004 | wicked-bus | npm peer | Optional | Absent: no-op emission. Present: at-least-once event delivery |
| D-005 | wicked-brain | External service | Optional | Absent: no-op memory writes. Present: failure-pattern and flake signals stored |
| D-006 | AI CLI harness (Claude Code / Antigravity / Codex / Cursor / Kiro / Copilot / OpenCode / Pi) | External | Required | wicked-testing provides skills; the harness executes them |
| D-007 | C++ toolchain (node-gyp) | Build-time | Optional | Only needed on platforms where `better-sqlite3` pre-built binaries are unavailable |
