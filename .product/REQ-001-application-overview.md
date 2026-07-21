---
name: REQ-001-application-overview
title: wicked-testing — Application Overview
status: draft
version: 0.1
date: 2026-07-21
author: mike.parcewski@gmail.com
review-required: true
---

# REQ-001 — Application Overview

## Purpose

wicked-testing gives AI coding CLIs a complete QE team. It ships as an npm
package and installs 48 skills into the host CLI's skill directory. Once
installed, users invoke skills via the standard CLI mechanism (e.g.
`/wicked-testing:plan`, `/wicked-testing:acceptance-testing`) — no separate
process is started per invocation.

The core problem it solves: when an AI agent tests its own work, it grades its
own homework. Self-reported PASS rates on agentic test runs are 80%+ above
human-reviewed rates because the same context that generated the code also
runs the tests and evaluates the results. wicked-testing eliminates that
by enforcing separation between the agent that writes the test plan, the agent
that executes it, and the agent that evaluates the evidence.

**Current version**: 0.9.0 (npm: `wicked-testing`)
**Supported CLIs**: Claude Code, Antigravity, Codex, Cursor, Kiro, Copilot,
OpenCode, Pi.

---

## Core User Flows

### Flow 1: Shift-Left Test Planning

User: `/wicked-testing:plan src/auth/ --project auth-service`

1. `plan` workflow skill activates.
2. Dispatches `test-strategist` (forked): maps the codebase to scenario
   candidates — positive paths, negative paths, edge cases.
3. Dispatches `testability-reviewer` (forked): flags designs that will be
   hard to test before a line is written.
4. Dispatches `requirements-quality-analyst` (forked): applies SMART+T to
   acceptance criteria; returns "ready-for-design" or "needs-iteration".
5. Dispatches `risk-assessor` (forked): scores risks by likelihood × impact,
   produces a mitigation matrix.
6. Writes a strategy record to the DomainStore (JSON + SQLite).
7. Emits `wicked.test.strategy.generated` on wicked-bus (if present).

Outcome: a written test strategy and scenario backlog. No tests are executed.

---

### Flow 2: Scenario Authoring

User: `/wicked-testing:authoring`

1. `authoring` workflow skill activates.
2. Routes to `test-designer`, `test-automation-engineer`, or
   `contract-testing-engineer` based on the user's intent.
3. Specialist produces scenario markdown files (`.md`, frontmatter + step
   blocks) and/or executable test code in the project's detected framework.
4. Scenario record written to DomainStore.
5. Emits `wicked.test.scenario.authored` on wicked-bus (if present).

Outcome: scenario files ready for the acceptance pipeline.

---

### Flow 3: 3-Agent Acceptance Pipeline

User: `/wicked-testing:acceptance-testing scenarios/login-positive.md`

1. `acceptance-testing` skill reads and parses the scenario file.
2. Creates a run record (`status: running`) in DomainStore.
3. **Writer** (`acceptance-test-writer`, forked, `allowed-tools: Read, Grep,
   Glob`) — reads scenario + code, produces a structured test plan with
   evidence gates and assertions. Cannot execute.
4. **Executor** (`acceptance-test-executor`, forked, `allowed-tools: Read,
   Write, Bash`) — follows the plan step-by-step, captures stdout/stderr/exit
   codes and file artifacts, writes evidence files. Makes no judgment.
5. **Reviewer** (`acceptance-test-reviewer`, forked, `allowed-tools: Read`) —
   receives only the evidence directory path. Never sees executor context or
   reasoning. Evaluates assertions against artifacts. Returns
   `PASS | FAIL | PARTIAL | INCONCLUSIVE`.
6. Run record updated to terminal status; verdict record written.
7. Evidence manifest (`manifest.json`) written to `evidence/<run-id>/`.
8. Emits `wicked.test.run.completed` and `wicked.test.verdict.created` on
   wicked-bus.

Outcome: a cryptographically-traceable verdict grounded in cold evidence.

---

### Flow 4: Evidence Review and Insight

User: `/wicked-testing:review` / `/wicked-testing:insight "what was the last verdict for login-positive?"`

**Review**: `semantic-reviewer` (forked) reads captured evidence and produces a
Gap Report per acceptance criterion: aligned / divergent / missing.

**Insight**: routes to `test-oracle` (forked), which keyword-matches the
question to one of 13 fixed parameterized SQL queries and returns structured
results. No ad-hoc SQL is generated.

Outcome: evidence-grounded answers about test history, coverage gaps, and
suite health.

---

### Flow 5: Vault Evidence Recording

wicked-vault (`bin/wicked-vault.mjs`) is the evidence backend. Specialist
skills (primarily `acceptance-test-executor`) call vault to record and
cryptographically sign evidence entries. The public output of each run is
`evidence/<run-id>/manifest.json`, whose schema is defined by
`schemas/evidence.json`. Downstream consumers (wicked-garden, CI checks) read
only the manifest — never the SQLite database.

Outcome: tamper-evident evidence chain for every acceptance run.
