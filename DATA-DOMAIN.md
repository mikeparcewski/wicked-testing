# DATA-DOMAIN — wicked-testing

This document summarizes the wicked-testing data domain. For the full normative specification used during the design phase, see the crew project design artifact at:

```
phases/design/DATA-DOMAIN.md
```

in the `feat-wicked-testing-qe-e2e-team` crew project.

---

## Overview

wicked-testing stores all domain data in two places simultaneously:

1. **JSON files** (canonical) — human-readable, editable by hand, in `.wicked-testing/{source}/{id}.json`
2. **SQLite index** (queryable) — `.wicked-testing/wicked-testing.db` via `better-sqlite3`

JSON is always written first (best-effort fdatasync — the call is wrapped in try/catch and silently continues on platforms that don't expose it), then the SQLite row is inserted. **On conflict, JSON wins.** If SQLite fails, the store degrades to JSON-only mode with a warning. On JSON-write failure the caller sees `ERR_JSON_WRITE_FAILED` (distinct from SQLite failure) so canonical-store-unavailable is distinguishable from index-unavailable.

---

## 7-Table Schema

The "7 tables" count **includes** the bookkeeping `schema_migrations` table alongside the six domain tables. If you see the constant `TABLES` in `lib/domain-store.mjs` with 6 entries, that's correct — it's the domain-table list (used for rebuild-index / allowlist); `schema_migrations` is managed by `lib/migrate.mjs` and not part of that list.

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `projects` | One row per project | `id`, `name`, `description` |
| `strategies` | Test strategies per project | `id`, `project_id`, `name`, `body` |
| `scenarios` | Scenario files registered | `id`, `project_id`, `strategy_id`, `name`, `format_version`, `source_path` |
| `runs` | Every scenario execution | `id`, `project_id`, `scenario_id`, `started_at`, `finished_at`, `status`, `evidence_path` |
| `verdicts` | Reviewer's verdict per run | `id`, `run_id`, `verdict`, `reviewer`, `reason` |
| `tasks` | Testing team work items | `id`, `project_id`, `title`, `status`, `assignee_skill` |
| `schema_migrations` | Schema version tracking | `version`, `applied_at`, `description` |

All tables include: `created_at`, `updated_at`, `deleted` (soft-delete), `deleted_at`.

Full DDL: `lib/migrations/001_initial.sql` (previously duplicated as `lib/schema.sql`; the duplicate was removed in Wave 4 in favor of a real migration runner at `lib/migrate.mjs`). Future migrations: `lib/migrations/NNN_description.sql`, applied in numeric order on DomainStore init.

---

## DomainStore API Surface

`lib/domain-store.mjs` exports:

```javascript
import { DomainStore, createDomainStore } from './lib/domain-store.mjs';

const store = new DomainStore('.wicked-testing');
// or
const store = createDomainStore({ root: '.wicked-testing' });

// CRUD (same method names as reference _domain_store.py)
store.create(source, payload)      // → Object
store.list(source, params)         // → Array<Object>
store.get(source, id)              // → Object | null
store.update(source, id, diff)     // → Object | null
store.delete(source, id)           // → boolean (soft-delete)
store.search(source, q, params)    // → Array<Object>

// Metadata
store.schemaVersion()              // → number
store.stats()                      // → { mode, counts, schema_version, drift_count }
store.rebuildIndex()               // → void (emergency escape hatch)
store.close()                      // → void

// Mode
store.mode                         // → "sqlite+json" | "json-only"
```

---

## Divergences from Reference Implementation

The Node.js implementation diverges from wicked-garden's `_domain_store.py` in these ways:

| # | Divergence | Rationale |
|---|-----------|-----------|
| 1 | Language: Python → Node.js ESM | No Python runtime requirement; ESM skill model |
| 2 | Storage: home-global → project-local | Test history is project-scoped (criterion 13) |
| 3 | Integration routing: removed | wicked-testing v1 is local-only |
| 4 | Event emission: no-op hook | Deferred to v2; call sites preserved |
| 5 | Synchronous-only API | Required by skill execution model (ADR-0001 force C3) |
| 6 | `schema_migrations` table added | Explicit version tracking for upgrade safety |
| 7 | Per-query prepared-statement cache | Enforces fixed-SQL oracle contract by code review |
| 8 | Dual-write atomicity (fsync + transaction) | Stricter than reference; JSON canonical guarantee |

---

## Oracle Query Library

The `test-oracle` skill uses `lib/oracle-queries.mjs` — a fixed library of 12 named parameterized queries:

- `scenarios_for_project`, `last_verdict_for_scenario`, `runs_by_status`
- `failed_runs_since`, `tasks_by_status`, `tasks_for_project`
- `current_strategy_for_project`, `recent_runs`, `verdicts_since`
- `row_counts`, `schema_version`, `most_recent_project`

No LLM-generated SQL. No ad-hoc queries. Every query is auditable by code review.

---

## Graceful Degradation

If `better-sqlite3` fails to load:

| Command | JSON-only behavior |
|---------|-------------------|
| setup, plan, scenarios, automate, run, acceptance | Continue — JSON written, no SQLite row, warning printed |
| oracle, tasks | Return `ERR_SQLITE_UNAVAILABLE` |
| stats | Return degraded stats (file counts only, `"mode":"json-only"`) |
| report | Read JSON files directly, annotate as `"mode":"json-only"` |
