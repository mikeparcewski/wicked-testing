---
name: DES-001-technical-design
title: wicked-testing — Technical Design
status: draft
version: 0.1
date: 2026-07-21
author: mike.parcewski@gmail.com
review-required: true
---

# DES-001 — Technical Design

## 1. 48-Skill Architecture

All product functionality is expressed as skills. There is no separate agent
component type, no command layer, and no server process. The `wicked-testing:*`
skill namespace is flat: every skill is invokable by name from the host CLI.

```
48 skills
├── 8 workflow skills      (user-invokable entry points; no context: fork)
├── 15 Tier-1 specialists  (public contract; all marked context: fork)
└── 25 Tier-2 specialists  (internal; all marked context: fork)
```

### Workflow Skills (8)

User-facing entry points. Each one orchestrates one or more specialist
dispatches. They share no conversation history with the specialists they
dispatch.

| Skill | Primary Function |
|---|---|
| `plan` | Shift-left strategy: test-strategist, testability-reviewer, requirements-quality-analyst, risk-assessor |
| `authoring` | Write scenarios and test code: test-designer, test-automation-engineer, contract-testing-engineer |
| `execution` | Run a scenario: scenario-executor |
| `acceptance-testing` | Full 3-agent pipeline: writer → executor → reviewer |
| `review` | Evaluate evidence: semantic-reviewer |
| `insight` | Query history and health: test-oracle, production-quality-engineer |
| `setup` | Initialize project config; detect CLI capabilities |
| `update` | Check npm for newer version; re-install if needed |

### Tier-1 Specialist Skills (15)

Stable dispatch surface. wicked-garden and other consumers may depend on these
names. See `docs/INTEGRATION.md` §3 for the full contract.

acceptance-test-executor, acceptance-test-reviewer, acceptance-test-writer,
code-analyzer, contract-testing-engineer, production-quality-engineer,
requirements-quality-analyst, risk-assessor, scenario-executor,
semantic-reviewer, test-automation-engineer, test-designer, test-oracle,
test-strategist, testability-reviewer

### Tier-2 Specialist Skills (25)

Internal. May be added, renamed, or removed without a breaking change.

a11y-test-engineer, ai-feature-test-engineer, chaos-test-engineer,
compliance-test-engineer, coverage-archaeologist,
data-quality-tester, e2e-orchestrator, exploratory-tester, flaky-test-hunter,
fuzz-property-engineer, iac-test-engineer, incident-to-scenario-synthesizer,
integration-test-engineer, load-performance-engineer,
localization-test-engineer, mutation-test-engineer,
observability-test-engineer, release-readiness-engineer,
security-test-engineer, snapshot-hygiene-auditor, test-code-quality-auditor,
test-data-manager, test-impact-analyzer, ui-component-test-engineer,
visual-regression-engineer

---

## 2. 3-Agent Acceptance Pipeline Isolation Model

The pipeline enforces Writer ≠ Executor ≠ Reviewer through three mechanisms:

### Mechanism 1: Forked Context (`context: fork`)

Every specialist skill carries `context: fork` in its frontmatter. The host
CLI (Claude Code) dispatches each role as a separate skill invocation with no
shared conversation history. The parent `acceptance-testing` skill receives
only the return value, not the forked context.

### Mechanism 2: Tool Allowlist (`allowed-tools`)

Each role's frontmatter declares which tools it may use:

| Role | `allowed-tools` | Effect |
|---|---|---|
| Writer | `Read, Grep, Glob, Skill` | Can read code; cannot execute or write state |
| Executor | `Read, Write, Bash` | Can execute and write artifacts; cannot evaluate |
| Reviewer | `Read` | Can read evidence files only; cannot execute or write |

On Claude Code, `allowed-tools` is hard-enforced at the skill boundary. On
other CLIs it is advisory; the isolation guarantee degrades but the pipeline
still runs.

### Mechanism 3: Evidence-Only Dispatch

The Reviewer receives exactly three inputs:
1. The scenario file path (for assertion reference)
2. The evidence directory path
3. The test plan

It never receives: the executor's stdout transcript, the executor's reasoning,
the executor's conversation history, or any run-specific outcome flags.

### Cold Context Injection

Before the Reviewer is dispatched, the orchestrator may write an optional
`context.md` to the evidence directory. This file may contain non-prejudicial
domain knowledge (WCAG thresholds, tool-version quirks). It must never contain:
prior verdicts, pass/fail rates, or any run-specific outcome. If the Reviewer
detects prejudicial content in this file it returns `INCONCLUSIVE` with reason
`CONTEXT_CONTAMINATION`.

### Verdict Values

| Value | Meaning |
|---|---|
| `PASS` | All assertions satisfied |
| `FAIL` | One or more assertions not satisfied |
| `PARTIAL` | Some assertions satisfied; others inconclusive or not executed |
| `INCONCLUSIVE` | Reviewer could not evaluate (missing evidence, context contamination) |

---

## 3. SQLite Domain Store Schema

The DomainStore wraps `better-sqlite3`. Schema is applied by the migration
runner from numbered migration files. These ledger modules (`domain-store`,
`oracle-queries`, `manifest`, `bus-emit`, `migrate`) and their migration SQL are
now **consumed from the published `wicked-ledger@^0.1.0` package**, not bundled
in `lib/` — wicked-testing imports them via `import { createDomainStore } from
"wicked-ledger"`. The schema below is unchanged (the package was reseeded
verbatim from testing's former `lib/`); this is a source-of-truth move, not a
behavior change.

### Tables

```sql
-- Domain tables (6)
projects       (id, name, description, created_at, updated_at, deleted, deleted_at)
strategies     (id, project_id, name, body, created_at, updated_at, deleted, deleted_at)
scenarios      (id, project_id, strategy_id, name, format_version, source_path,
                created_at, updated_at, deleted, deleted_at)
runs           (id, project_id, scenario_id, started_at, finished_at, status,
                evidence_path, created_at, updated_at, deleted, deleted_at)
verdicts       (id, run_id, verdict, reviewer, reason, evidence_path,
                created_at, updated_at, deleted, deleted_at)
tasks          (id, project_id, title, status, assignee_skill,
                created_at, updated_at, deleted, deleted_at)

-- Bookkeeping (1)
schema_migrations  (version, applied_at, description)
```

Current schema version: 3. Future migrations: `lib/migrations/NNN_*.sql`.

### Dual-Write Protocol

```
create(source, payload):
  1. Assign UUID
  2. Write {root}/{source}/{id}.json  (fdatasync best-effort, tmp+rename)
  3. INSERT INTO {source} ...         (inside db.transaction())
  4. On SQLite INSERT failure: retain JSON, log warning, increment drift_count
```

JSON is always written first. On conflict, JSON is the canonical record. The
`rebuildIndex()` method reconstructs the SQLite index from JSON files.

### DomainStore API

```javascript
store.create(source, payload)     → Object
store.list(source, params)        → Array<Object>
store.get(source, id)             → Object | null
store.update(source, id, diff)    → Object | null
store.delete(source, id)          → boolean  // soft-delete
store.search(source, q, params)   → Array<Object>
store.schemaVersion()             → number
store.stats()                     → { mode, counts, schema_version, drift_count }
store.rebuildIndex()              → void
store.close()                     → void
store.mode                        // "sqlite+json" | "json-only"
```

---

## 4. Evidence Manifest

Schema: `schemas/evidence.json`. Written to
`.wicked-testing/evidence/<run-id>/manifest.json` by the acceptance pipeline
after the Reviewer produces a verdict.

The manifest is the **public contract**. Downstream consumers read only this
file; they do not read the SQLite database, `evidence.json`, or `step-N.json`
files. The schema is versioned; breaking changes require a major version bump
in the schema and a migration note in `docs/EVIDENCE.md`.

Key manifest fields: `run_id`, `scenario` (name + path), `verdict`,
`artifacts` (array of captured file references), `created_at`, `reviewer`
(skill name), signature fields (from wicked-vault).

---

## 5. wicked-vault Evidence Backend

The published `wicked-vault` package (a runtime dependency) provides
cryptographic signing for evidence records. The acceptance pipeline invokes the
resolved `wicked-vault` binary (from `node_modules/.bin`, or `npx wicked-vault`)
as a child process after evidence files are written. Vault reads the evidence
directory and writes the signed `manifest.json`.

If vault is absent:
- Evidence files are still written as JSON.
- `manifest.json` is written without a signature.
- The verdict is recorded normally.
- The pipeline does not fail; it degrades gracefully.

---

## 6. wicked-bus Event Contract

wicked-testing emits events via `lib/bus-emit.mjs` using fire-and-forget
process spawn. If the spawn fails or wicked-bus is absent, a single debug line
is printed to stderr and the workflow continues.

| Event | Trigger |
|---|---|
| `wicked.test.strategy.generated` | Strategy record created |
| `wicked.test.scenario.authored` | Scenario record created or updated |
| `wicked.test.run.started` | Run row written with `status: running` |
| `wicked.test.run.completed` | Run row updated to terminal status |
| `wicked.test.verdict.created` | Reviewer writes a verdict |
| `wicked.test.evidence.captured` | `manifest.json` written |

Write order: `runs` is updated to terminal status before the `verdicts` row is
written, so `wicked.test.run.completed` fires before `wicked.test.verdict.
created`. Consumers that subscribe to both events can safely join on `run_id`.

---

## 7. Tier-1 / Tier-2 Specialist Split

The split serves two purposes:

1. **Stability contract**: Tier-1 names are stable API surface. Consumers
   (wicked-garden, etc.) may hard-code Tier-1 dispatch names. Tier-2 names
   are internal and may change.

2. **Growth policy**: new domain specialists are added at Tier-2, not Tier-1.
   Promotion to Tier-1 requires a documented decision (breaking change to
   downstream consumers) and a version bump.

The `ARCHITECTURE.md` and `docs/INTEGRATION.md` are the normative references
for which skills are in each tier.

---

## 8. Distribution Model

```
npm publish
  └── skills/         ← all 48 skill directories
  └── bin/            ← wicked-testing, wicked-qe CLIs
  └── lib/            ← domain-store, oracle-queries, migrations, bus-emit
  └── schemas/        ← evidence.json
  └── install.mjs     ← CLI target detection + file copy logic
```

`npx wicked-testing install` runs `install.mjs`, which:

1. Detects which AI CLIs are present by identity markers.
2. Copies `skills/` into each target's skill directory.
3. Installs lifecycle hooks (JSON hooks for Claude Code / Antigravity / Codex /
   Cursor / Kiro / Copilot; TypeScript plugins for OpenCode / Pi).
4. Runs the bootstrap self-test.
5. Writes a version marker file per CLI target.

The install is idempotent. A CLI target is only updated if the npm version is
newer than the marker file's recorded version (unless `--force` is passed).
