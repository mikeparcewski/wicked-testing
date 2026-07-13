# wicked-testing Integration Contract

This document defines the **public surface** that wicked-garden (and any other
consumer) depends on. Everything here is stable across minor versions — breaking
changes require a major bump.

Anything **not** listed here is an internal implementation detail. Consumers must
not depend on SQL schema, file paths inside `lib/`, or skill definition contents.

---

## 1. Namespace

All user-facing surface lives under the `wicked-testing:` namespace. Everything
is a skill — there are no separate agent or command component types.

- Skills: `wicked-testing:<name>`
- Slash invocation of workflow skills: `/wicked-testing:<name>`
- Worker skills are dispatched by the same `wicked-testing:<name>` strings that
  used to be agent `subagent_type` values — the dispatch names are unchanged.

The `qe:` prefix is **retired**. It appears only in wicked-garden backward-compat
aliases for one minor version.

---

## 2. Core Skills (Tier 1 — stable)

Five skills form the public surface. Consumers may reference these by name.

| Skill                     | Purpose                                                        |
|---------------------------|----------------------------------------------------------------|
| `wicked-testing:plan`     | Test strategy, risk, testability, requirements quality         |
| `wicked-testing:authoring`| Scenario writing, test code generation, test data / fixtures   |
| `wicked-testing:execution`| Run tests, collect evidence, write to ledger                   |
| `wicked-testing:review`   | Independent verdict, semantic review, test-quality audit       |
| `wicked-testing:insight`  | Stats, reports, flaky detection, coverage archaeology          |

Each Tier-1 skill **internally** dispatches Tier-2 specialist skills
(ui-component-test-engineer, load-performance-engineer, etc.) into isolated
forked contexts (`context: fork`) based on the nature of the work. Consumers
do not invoke Tier-2 specialists directly — they always go through Tier-1.

This keeps the integration contract narrow. Adding a new Tier-2 specialist
is not a breaking change.

---

## 3. Core Worker Skills (Tier 1 — stable dispatch names)

Consumers (notably wicked-garden's crew gate) may dispatch these forked worker
skills by name. The names are identical to the former agent `subagent_type`
values, so nothing changed for consumers. This list is frozen; renames require
a major version.

| Skill (dispatch name)                              | Owning Skill   |
|----------------------------------------------------|----------------|
| `wicked-testing:test-strategist`                   | plan           |
| `wicked-testing:testability-reviewer`              | plan           |
| `wicked-testing:requirements-quality-analyst`      | plan           |
| `wicked-testing:risk-assessor`                     | plan           |
| `wicked-testing:test-designer`                     | authoring      |
| `wicked-testing:test-automation-engineer`          | authoring      |
| `wicked-testing:acceptance-test-writer`            | authoring      |
| `wicked-testing:scenario-executor`                 | execution      |
| `wicked-testing:acceptance-test-executor`          | execution      |
| `wicked-testing:contract-testing-engineer`         | execution      |
| `wicked-testing:acceptance-test-reviewer`          | review         |
| `wicked-testing:semantic-reviewer`                 | review         |
| `wicked-testing:code-analyzer`                     | review         |
| `wicked-testing:production-quality-engineer`       | review         |
| `wicked-testing:test-oracle`                       | insight        |

Tier-2 specialist skills (integration, ui-component, e2e, visual, a11y, load,
chaos, fuzz, mutation, i18n, data-quality, observability, flaky-hunter, etc.)
are **not** part of the public contract. They are dispatched by Tier-1 skills.

---

## 4. Bus Events (public contract)

wicked-testing emits events to [wicked-bus](https://github.com/mikeparcewski/wicked-bus)
when it is installed. **Emission is best-effort**: if wicked-bus is not present,
the emit is a no-op; wicked-testing's own SQLite ledger is always written.

### Conventions

- Event names follow wicked-ecosystem convention: `wicked.<domain>.<noun>.<verb>`
- **Two distinct notions of "domain" — do not conflate them:**
  - The **2nd segment of the event *type*** is the **short** domain slug (`test`), e.g.
    `test` in `wicked.test.run.completed`. This is the compact routing token baked
    into the type string.
  - The **`domain` payload field / SQLite column** is the **full package name**
    `wicked-testing`. It never abbreviates to `test`.
  - So a completed run emits type `wicked.test.run.completed` with `domain: wicked-testing`.
- `subdomain` scopes by functional area (`ledger`, `scenario`, `testrun`, `verdict`, `evidence`)
- Payload follows the standard tier rules — IDs and outcomes always, small categoricals
  when relevant, never content / diffs / secrets

### Catalog (v1)

| Event Type                    | Subdomain             | Description                                           |
|-------------------------------|-----------------------|-------------------------------------------------------|
| `wicked.test.strategy.generated`  | `scenario.authoring`  | A test strategy document was produced                 |
| `wicked.test.scenario.authored` | `scenario.authoring`  | A scenario file was created or updated                |
| `wicked.test.run.started`       | `testrun`             | A test run began                                      |
| `wicked.test.run.completed`       | `testrun`             | A test run completed (any terminal status)            |
| `wicked.test.verdict.created`       | `verdict`             | A reviewer emitted a verdict (PASS / FAIL / N-A / SKIP)|
| `wicked.test.evidence.captured` | `evidence`            | Evidence artifacts written to disk for a run          |
| `wicked.test.evidence.recorded` | `vault.record`        | A single evidence envelope recorded via `wicked-vault record` |
| `wicked.test.contract.published`| `contract`            | plugin.json manifest synced; full skill/tier roster   |

### QE Gate Events

| Event | Trigger | Key fields |
|-------|---------|------------|
| `wicked.qe.gate.passed` | `wicked-qe gate` on PASS verdict | `run_id`, `context`, `gate_verdict`, `exit_code`, `verdict_summary`, `mode`, `completed_at`, `scenario_count` |
| `wicked.qe.gate.failed` | `wicked-qe gate` on FAIL verdict | same |
| `wicked.qe.gate.conditional` | `wicked-qe gate` on CONDITIONAL or SYSTEM_ERROR | same |
| `wicked.qe.deploy.completed` | `wicked-qe gate` on PASS only | `run_id`, `project_id` |

### Payload shape (common fields)

All events include:

```
{
  "event_type": "wicked.test.run.completed",
  "domain": "wicked-testing",
  "subdomain": "testrun",
  "emitted_at": "2026-04-20T14:03:12.004Z",
  "project_id": "<uuid>",
  "run_id": "<uuid>",
  "wicked_testing_version": "0.1.0"
}
```

### Per-event additional fields

**`wicked.test.strategy.generated`** — `{ strategy_id, project_id, scenario_count }`
**`wicked.test.scenario.authored`** — `{ scenario_id, strategy_id, project_id, format_version }`
**`wicked.test.run.started`** — `{ run_id, scenario_id, project_id, started_at }`
**`wicked.test.run.completed`** — `{ run_id, scenario_id, status, started_at, finished_at, evidence_path }`
**`wicked.test.verdict.created`** — `{ verdict_id, run_id, verdict: "PASS|FAIL|N-A|SKIP", reviewer, evidence_path }`
**`wicked.test.evidence.captured`** — union payload so one subscriber schema serves
both emit sites (the verdict path in `lib/bus-emit.mjs` and the manifest path in
`skills/acceptance-testing/SKILL.md`): common `{ project_id, run_id, evidence_path,
wicked_testing_version }` plus optional `{ verdict_id, vault_payload_sha,
artifact_count }` — each optional field is `null` when the emitting site lacks it
(the verdict path has `verdict_id` + `vault_payload_sha` but `artifact_count: null`;
the manifest path has `artifact_count` but `verdict_id: null` + `vault_payload_sha: null`).
**`wicked.test.evidence.recorded`** — emitted by `wicked-vault record` (subdomain
`vault.record`) for a single recorded envelope: `{ scope, phase, claim_id, kind,
source, id, envelope_hash, payload_sha256, criteria_authored_by, status_at_record }`.
Distinct from `wicked.test.evidence.captured`, which describes a whole run's artifacts.
**`wicked.test.contract.published`** — `{ version: "<semver>", agents: [{ subagent_type: "wicked-testing:<name>", tier: 1|2 }] }`
(The `agents` / `subagent_type` payload field names are retained for wire
compatibility; each entry describes a forked worker skill and the value is its
skill dispatch name.)

Status values for `wicked.test.run.completed`: `passed | failed | errored | skipped`.

### What consumers get

wicked-garden's crew gate subscribes to `wicked.test.verdict.created` with
`domain: wicked-testing`. That's the entire read surface — no SQLite access
required.

---

## 5. Brain Memories (optional enrichment)

When [wicked-brain](https://github.com/mikeparcewski/wicked-brain) is installed,
wicked-testing writes memories for non-trivial events. Consumers may search
these memories; the shapes are part of the contract.

### Memory types written by wicked-testing

| Memory type       | Written when                                     | Tier       |
|-------------------|--------------------------------------------------|------------|
| `failure-pattern` | `FAIL` verdict on a scenario previously passing  | semantic   |
| `flake-signal`    | Test oscillates pass/fail across runs            | episodic   |
| `coverage-gap`    | Coverage archaeologist finds an untested hotspot | semantic   |
| `test-decision`   | A reviewer CONDITIONAL emits actionable feedback | episodic   |

### Memory frontmatter

```yaml
---
name: <short-title>
description: <one-line summary>
type: failure-pattern | flake-signal | coverage-gap | test-decision
source: wicked-testing
source_version: <semver>
project_id: <uuid>
scenario_id: <uuid>    # when applicable
run_id: <uuid>         # when applicable
---
```

If wicked-brain is not installed, memory writes are a no-op.

---

## 6. Evidence Artifact Paths

Evidence lives project-local (not home-global), under `.wicked-testing/evidence/`.
The path is included in every `wicked.test.evidence.captured` and
`wicked.test.verdict.created` event.

```
<project-root>/.wicked-testing/
  evidence/
    <run-id>/
      manifest.json         # verdict + artifact index (schema: schemas/evidence.json)
      artifacts/
        <name>.<ext>        # screenshots, logs, curl output, etc.
```

Consumers **may read `manifest.json`** for any referenced run id — its schema
is public (see [EVIDENCE.md](EVIDENCE.md)). Consumers must not parse artifact
content blindly; use the manifest's `artifacts[]` index.

---

## 7. Graceful Degradation Rules

| Dependency       | Present behavior                          | Absent behavior                          |
|------------------|-------------------------------------------|------------------------------------------|
| SQLite           | Ledger writes + oracle queries            | wicked-testing fails loud (required)     |
| wicked-bus       | Emit events on every significant action   | No-op; log a single debug line           |
| wicked-brain     | Write memories on interesting signals     | No-op; log a single debug line           |
| wicked-garden    | Events consumed by crew gate              | N/A (wicked-garden is downstream)        |

wicked-testing is usable **standalone** — only SQLite is required.
Bus + brain integration is pure upside when the ecosystem is present.

---

## 8. Version & Compatibility

- wicked-testing uses semver.
- The surface in this document is stable across **minor** versions.
- Breaking changes to namespace, skill dispatch names, event types, evidence manifest
  schema, or degradation rules require a **major** version.
- wicked-garden pins a minor-version range (`^X.Y`) of wicked-testing in its
  plugin.json `wicked_testing_version` field.
- SessionStart hook in wicked-garden verifies the installed version satisfies
  the pin; mismatches print a one-line actionable nudge.

---

## 9. What Is NOT the Contract

To prevent coupling rot, these are explicitly internal:

- SQL schema in `lib/schema.sql`
- Any path inside `lib/`, `scripts/`, or `node_modules/`
- Tier-2 specialist skill names
- Internal event payload fields not listed above
- Ledger JSON file format under `.wicked-testing/` (except `evidence/<run>/manifest.json`)
- Oracle query set in `lib/oracle-queries.mjs`

Consumers that reach into internals take on their own breakage risk. File an
issue if you need something promoted to the public contract.
