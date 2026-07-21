---
name: REQ-003-domain-model
title: wicked-testing — Domain Model
status: draft
version: 0.1
date: 2026-07-21
author: mike.parcewski@gmail.com
review-required: true
---

# REQ-003 — Domain Model

## Overview

The wicked-testing domain model describes the core entities that are created,
persisted, and queried during a testing session. All entities are stored in the
project-local DomainStore (dual-write: JSON canonical + SQLite index).

---

## Entities

### Project

The top-level grouping entity. One project per codebase or sub-scope. Created
by `/wicked-testing:setup` and referenced by all other entities.

**Key fields**: `id`, `name`, `description`, `created_at`

---

### Strategy

A test strategy document produced by `test-strategist`. Records the planned
approach for a project: which areas to cover, risk posture, scenario backlog.
One-to-many with Project.

**Key fields**: `id`, `project_id`, `name`, `body` (full strategy text)

---

### Scenario

A self-contained markdown file that describes a testable behavior: steps,
expected evidence, and assertions. Scenarios are the executable unit for the
acceptance pipeline. A scenario is registered in the DomainStore when first
encountered by a workflow skill.

**Key fields**: `id`, `project_id`, `strategy_id` (nullable), `name`,
`source_path`, `format_version`

Scenario files live under `scenarios/` or anywhere on disk; the store records
their path. The file format is defined in `SCENARIO-FORMAT.md`.

---

### TestRun (runs)

One row per execution of a scenario. Created at the start of
`acceptance-testing` with `status: running`; updated to a terminal status
(`passed | failed | partial | inconclusive`) when the Reviewer produces a
verdict.

**Key fields**: `id`, `project_id`, `scenario_id`, `started_at`,
`finished_at`, `status`, `evidence_path`

The `evidence_path` points to `.wicked-testing/evidence/<run-id>/`.

---

### Verdict

The Reviewer's output for a run. Created by `acceptance-test-reviewer` after
reading cold evidence. One verdict per run (1:1 with TestRun).

**Key fields**: `id`, `run_id`, `verdict` (`PASS | FAIL | PARTIAL |
INCONCLUSIVE`), `reviewer` (skill name), `reason`, `evidence_path`

A verdict of `INCONCLUSIVE` with `CONTEXT_CONTAMINATION` indicates the
Reviewer detected prejudicial content in the evidence directory and refused to
evaluate.

---

### Task

A work item created by the testing team (e.g. from `incident-to-scenario-
synthesizer` or manually via `test-data-manager`). Tasks are not part of the
acceptance pipeline; they are a backlog mechanism.

**Key fields**: `id`, `project_id`, `title`, `status`, `assignee_skill`

---

### ExecutionRecord (evidence files)

The physical output of `acceptance-test-executor`. Not a database table — a
set of JSON files written to `.wicked-testing/evidence/<run-id>/`:

- `evidence.json` — overall run summary (internal)
- `step-N.json` — per-step stdout, stderr, exit code, file artifacts (internal)

Execution records are referenced by the Reviewer via file path only.

---

### EvidenceManifest

The public output of a completed acceptance run. Written to
`.wicked-testing/evidence/<run-id>/manifest.json`. Schema defined in
`schemas/evidence.json`. This is the **only** artifact downstream consumers
(wicked-garden, CI checks) are permitted to read.

**Key fields**: `run_id`, `scenario`, `verdict`, `artifacts[]`, `created_at`,
`reviewer`, cryptographic signature fields

---

### DomainStore

The storage abstraction (`lib/domain-store.mjs`). Exposes a uniform CRUD API
over both JSON files and the SQLite index. Not a domain entity itself, but the
boundary through which all entities are created and queried.

**Modes**: `sqlite+json` (normal) | `json-only` (degraded, when
`better-sqlite3` fails to load)

---

### SkillDispatch

Not a stored entity. The act of a workflow skill invoking a specialist skill
in a new forked context (`context: fork`). Each dispatch carries a constrained
tool allowlist that enforces the role's permissions:

| Role | Tool allowlist |
|---|---|
| Writer | `Read, Grep, Glob, Skill` |
| Executor | `Read, Write, Bash` |
| Reviewer | `Read` |

---

## Relationships

```
Project ──< Strategy
Project ──< Scenario
Project ──< TestRun
Project ──< Task
Scenario ──< TestRun
Strategy ──< Scenario (nullable FK)
TestRun ──1 Verdict
TestRun ──1 EvidenceManifest (file, not row)
TestRun ──< ExecutionRecord (files, not rows)
```

---

## Soft-Delete Convention

All six domain tables include `deleted` (boolean), `deleted_at` (timestamp).
The `delete()` API performs a soft-delete. Hard deletion is not exposed through
the DomainStore API.

---

## Schema Versioning

A seventh table, `schema_migrations`, is managed by `lib/migrate.mjs` and
tracks which migration scripts have been applied. It is not part of the domain
entity model. Current schema version: 2.
