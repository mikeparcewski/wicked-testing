---
name: REQ-002-technology-constraints
title: wicked-testing — Technology Constraints
status: draft
version: 0.1
date: 2026-07-21
author: mike.parcewski@gmail.com
review-required: true
---

# REQ-002 — Technology Constraints

## Runtime

| Constraint | Value |
|---|---|
| Runtime | Node.js ≥ 20 |
| Module format | ESM (`"type": "module"` in package.json) — all library files use `.mjs` extensions |
| OS | macOS (x64/arm64), Linux (x64/arm64), Windows (Git Bash / WSL) |
| Install model | npm package; skills are copied into the host CLI's directory at install time |

## Dependencies

### better-sqlite3

- Synchronous SQLite driver. The synchronous API is a hard requirement: the
  skill execution model is synchronous (skills run inline in the CLI context),
  and async SQLite would require a separate worker or IPC boundary.
- Pre-built binaries ship for macOS x64/arm64, Linux x64/arm64, Windows x64.
  On unsupported platforms, `npm install` falls back to `node-gyp rebuild`,
  which requires a C++ toolchain.
- If `better-sqlite3` fails to load at runtime, the store degrades to
  JSON-only mode. Oracle and task queries return `ERR_SQLITE_UNAVAILABLE`.

### wicked-bus (optional)

- When `wicked-bus` is on PATH, wicked-testing emits events on every
  significant action (strategy generated, run started, run completed, verdict
  created, evidence captured).
- If absent or the spawn fails, emission is a no-op. The product must continue
  to function fully without wicked-bus.

### wicked-vault (required for evidence gate)

- `bin/wicked-vault.mjs` is the evidence backend. Records and cryptographically
  signs evidence entries. Required for the acceptance pipeline to produce a
  verifiable manifest.
- Skills invoke vault via child process. If vault is absent, evidence is still
  written as JSON files but without cryptographic signatures.

### wicked-brain (optional)

- When wicked-brain is present and serving, wicked-testing writes memories on
  high-signal events: persistent FAIL patterns, flaky test discoveries, coverage
  gaps from the archaeologist.
- Absent or unreachable: no-op. No product functionality is gated on
  wicked-brain.

## Distribution Constraints

- Skills are the **only** distributed surface. No separate agent files, command
  files, or server processes are installed.
- Install is idempotent and version-aware. Re-running `npx wicked-testing
  install` on the same CLI target is safe.
- Each CLI target tracks the installed version in a marker file; `update`
  replaces only when the npm version is newer.
- The installed skills must run natively in the host CLI after copy — no
  per-invocation `npx` or network call.

## Offline Requirement

The product must work fully offline after install. No skill may make outbound
HTTP calls as part of its core function. wicked-bus emission and wicked-brain
writes are optional integrations; their absence must not block any workflow.

## Multi-CLI Harness Constraint

wicked-testing installs into whichever AI CLIs are detected (Claude Code,
Antigravity, Codex, Cursor, Kiro, Copilot, OpenCode, Pi). The skill format
must be compatible with each target's skill resolver. Reviewer isolation
(`allowed-tools: [Read]`, `context: fork`) is hard-enforced on Claude Code;
it is advisory on other CLIs that do not enforce frontmatter tool restrictions.

## Storage Constraint

All state is project-local: `.wicked-testing/` in the project root. There is
no home-global store. A project's test history travels with its code and is
visible in version control (if committed).

## Schema Versioning

The SQLite schema is versioned via `lib/migrations/NNN_*.sql` applied in
numeric order on DomainStore initialization. The current schema version is 3.
The store refuses to write if the database version exceeds the code's known
version, and prints an upgrade message.

## Node.js Compatibility Window

The minimum supported version is Node.js 20 (LTS). Features above that
baseline are not used without a runtime check. `crypto.randomUUID()` (Node 14.17+)
and `fs.fdatasync` (wrapped in try/catch for platform availability) are the
only non-universal APIs used.
