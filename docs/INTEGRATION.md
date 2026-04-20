# wicked-testing Integration Contract

This document defines the **public surface** that wicked-garden (and any other
consumer) depends on. Everything here is stable across minor versions — breaking
changes require a major bump.

Anything **not** listed here is an internal implementation detail. Consumers must
not depend on SQL schema, file paths inside `lib/`, or agent definition contents.

---

## 1. Namespace

All user-facing surface lives under the `wicked-testing:` namespace.

- Skills: `wicked-testing:<name>`
- Agents: `subagent_type: wicked-testing:<name>`
- Commands: `/wicked-testing:<name>`

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

Each Tier-1 skill **internally** dispatches Tier-2 specialist agents
(ui-component-test-engineer, load-performance-engineer, etc.) based on the
nature of the work. Consumers do not invoke Tier-2 agents directly — they
always go through Tier-1.

This keeps the integration contract narrow. Adding a new Tier-2 specialist
is not a breaking change.

---

## 3. Core Agents (Tier 1 — stable dispatch names)

Consumers (notably wicked-garden's crew gate) may dispatch these agents by
subagent_type. This list is frozen; renames require a major version.

| Agent subagent_type                                | Owning Skill   |
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
| `wicked-testing:continuous-quality-monitor`        | review         |
| `wicked-testing:test-oracle`                       | insight        |

Tier-2 specialists (integration, ui-component, e2e, visual, a11y, load, chaos,
fuzz, mutation, i18n, data-quality, observability, flaky-hunter, etc.) are
**not** part of the public contract. They are dispatched by Tier-1 skills.

---

## 4. Bus Events (public contract)

wicked-testing emits events to [wicked-bus](https://github.com/mikeparcewski/wicked-bus)
when it is installed. **Emission is best-effort**: if wicked-bus is not present,
the emit is a no-op; wicked-testing's own SQLite ledger is always written.

### Conventions

- Event names follow wicked-ecosystem convention: `wicked.<noun>.<past-tense-verb>`
- `domain` field is always `wicked-testing`
- `subdomain` scopes by functional area (`ledger`, `scenario`, `testrun`, `verdict`, `evidence`)
- Payload follows the standard tier rules — IDs and outcomes always, small categoricals
  when relevant, never content / diffs / secrets

### Catalog (v1)

| Event Type                    | Subdomain             | Description                                           |
|-------------------------------|-----------------------|-------------------------------------------------------|
| `wicked.teststrategy.authored`| `scenario.authoring`  | A test strategy document was produced                 |
| `wicked.scenario.authored`    | `scenario.authoring`  | A scenario file was created or updated                |
| `wicked.testrun.started`      | `testrun`             | A test run began                                      |
| `wicked.testrun.finished`     | `testrun`             | A test run completed (any terminal status)            |
| `wicked.verdict.recorded`     | `verdict`             | A reviewer emitted a verdict (PASS / FAIL / N-A / SKIP)|
| `wicked.evidence.captured`    | `evidence`            | Evidence artifacts written to disk for a run          |

### Payload shape (common fields)

All events include:

```
{
  "event_type": "wicked.testrun.finished",
  "domain": "wicked-testing",
  "subdomain": "testrun",
  "emitted_at": "2026-04-20T14:03:12.004Z",
  "project_id": "<uuid>",
  "run_id": "<uuid>",
  "wicked_testing_version": "0.1.0"
}
```

### Per-event additional fields

**`wicked.teststrategy.authored`** — `{ strategy_id, project_id, scenario_count }`
**`wicked.scenario.authored`** — `{ scenario_id, strategy_id, project_id, format_version }`
**`wicked.testrun.started`** — `{ run_id, scenario_id, project_id, started_at }`
**`wicked.testrun.finished`** — `{ run_id, scenario_id, status, started_at, finished_at, evidence_path }`
**`wicked.verdict.recorded`** — `{ verdict_id, run_id, verdict: "PASS|FAIL|N-A|SKIP", reviewer, evidence_path }`
**`wicked.evidence.captured`** — `{ run_id, evidence_path, artifact_count }`

Status values for `wicked.testrun.finished`: `passed | failed | errored | skipped`.

### What consumers get

wicked-garden's crew gate subscribes to `wicked.verdict.recorded` with
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
The path is included in every `wicked.evidence.captured` and
`wicked.verdict.recorded` event.

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
- Breaking changes to namespace, agent names, event types, evidence manifest
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
- Tier-2 specialist agent names
- Internal event payload fields not listed above
- Ledger JSON file format under `.wicked-testing/` (except `evidence/<run>/manifest.json`)
- Oracle query set in `lib/oracle-queries.mjs`

Consumers that reach into internals take on their own breakage risk. File an
issue if you need something promoted to the public contract.
