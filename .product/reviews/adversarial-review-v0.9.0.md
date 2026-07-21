---
name: adversarial-review-v0.9.0
title: "wicked-testing v0.9.0 — Adversarial Review"
status: PASS
date: 2026-07-21
reviewer: claude-council-adversarial (independent review session)
scope: v0.9.0 release candidate — 48 skills, DomainStore, oracle, acceptance pipeline, doctor
---

# wicked-testing v0.9.0 — Adversarial Review

## Overall Verdict: PASS

All five CRITICAL requirements are satisfied with code-level evidence. No CRITICAL or HIGH severity findings are OPEN. Three MEDIUM findings are open coverage gaps. One LOW finding (L-01) is an acknowledged gap; one LOW finding (L-02) passes its assertion check. None block release.

---

## Summary Table

| Severity | Total | PASS | OPEN |
|----------|-------|------|------|
| CRITICAL | 5     | 5    | 0    |
| HIGH     | 0     | 0    | 0    |
| MEDIUM   | 3     | 0    | 3    |
| LOW      | 2     | 1    | 1    |

---

## Finding Table

| ID   | Dimension                        | Severity | Status | Finding |
|------|----------------------------------|----------|--------|---------|
| C-01 | DomainStore dual-write order     | CRITICAL | PASS   | JSON written before SQLite in `create()` |
| C-02 | Oracle static queries            | CRITICAL | PASS   | All 13 queries are static; no injection path |
| C-03 | Executor ≠ Reviewer separation   | CRITICAL | PASS   | Structurally separate skills with incompatible tool sets |
| C-04 | Doctor schema version dynamic    | CRITICAL | PASS   | Imports `SCHEMA_VERSION` dynamically; not hardcoded |
| C-05 | SCHEMA_VERSION exported          | CRITICAL | PASS   | Exported named constant at line 76 |
| M-01 | SQLite degradation path untested | MEDIUM   | OPEN   | No test mocks better-sqlite3 load failure |
| M-02 | Dual-write order untested        | MEDIUM   | OPEN   | Consistency tested; sequence not explicitly asserted |
| M-03 | runs_by_status routing ambiguity | MEDIUM   | OPEN   | No filter-override for status+runs; keyword tie with `recent_runs` |
| L-01 | vault_payload_sha not auto-wired | LOW      | OPEN   | Acknowledged gap; documented in source (lines 104–119) |
| L-02 | Scenario step-3 count check loose| LOW     | PASS   | `< 12` guard accepts 12+ queries; passes with 13 in place |

---

## Per-Finding Analysis

### C-01 — DomainStore dual-write order (CRITICAL: PASS)

**Claim**: JSON is written before the SQLite index on every `create()`.

**Evidence**: `lib/domain-store.mjs` lines 412–427:

```js
// 1. Atomic JSON write.
try {
  atomicWriteJson(this._jsonPath(source, record.id), record);  // line 415
} catch (err) {
  throw jsonWriteError(source, record.id, "create", err);
}

// 2. SQLite insert ...
this._dbInsert(source, record);  // line 422

// 3. Bus emission ...
this._emitEvent("create", source, record.id, record);  // line 425
```

The code is synchronous throughout (`writeFileSync` via `atomicWriteJson`, `better-sqlite3` sync API). There is no async gap between the JSON write and the SQLite insert. A crash between lines 415 and 422 leaves JSON present and SQLite absent — the defined safe-degradation state. A crash after line 422 leaves both present. No path exists where SQLite leads JSON.

The pre-write verdict guard (`_assertVerdictValue`, lines 220–230) fires before any write, so a bogus verdict fails atomically — nothing lands in either store.

**Verdict: PASS**

---

### C-02 — Oracle queries are all static strings (CRITICAL: PASS)

**Claim**: All 13 named queries in `lib/oracle-queries.mjs` are static; no SQL injection path exists.

**Evidence**: All 13 `sql` properties are string literals. The two template clauses — `{{SINCE_CLAUSE}}` in `runs_by_status` and `{{PROJECT_CLAUSE}}` in `recent_runs` — are substituted by `buildOracleQuery` with one of two hardcoded string fragments:

```js
sql = sql.replace("{{SINCE_CLAUSE}}", filterArgs.since ? "AND r.started_at >= ?" : "");
sql = sql.replace("{{PROJECT_CLAUSE}}", filterArgs.project ? "AND p.name = ?" : "");
```

No user-supplied value is interpolated into the SQL string; only bound via positional `?` parameters. `oracle-queries.test.mjs` line 100 asserts `doesNotMatch(stripped, /\{\{/)` — any unwhitelisted template hole fails the test. Line 101 asserts no JS template interpolation (`${}`) is present in any query body.

**13 query names confirmed** (counted from `QUERIES` object): `scenarios_for_project`, `last_verdict_for_scenario`, `runs_by_status`, `failed_runs_since`, `tasks_by_status`, `tasks_for_project`, `current_strategy_for_project`, `recent_runs`, `verdicts_since`, `row_counts`, `schema_version`, `baseline_matches_for_scenario`, `most_recent_project`.

**Verdict: PASS**

---

### C-03 — Executor ≠ Reviewer structural separation (CRITICAL: PASS)

**Claim**: The acceptance pipeline enforces three isolation layers between executor and reviewer.

**Evidence — Layer 1 (tool restriction)**:

- `skills/acceptance-test-executor/SKILL.md` frontmatter: `allowed-tools: Read, Write, Bash`
- `skills/acceptance-test-reviewer/SKILL.md` frontmatter: `allowed-tools: Read`

The reviewer cannot run Bash, cannot write files. On Claude Code this is host-enforced, not advisory.

**Evidence — Layer 2 (evidence-only dispatch)**:

`skills/acceptance-testing/SKILL.md` section 5 dispatches the reviewer with only:
- scenario file path
- evidence directory path
- test plan path

Executor stdout, executor reasoning, and conversational context are explicitly excluded from the dispatch call. The `context-md-validator.mjs` (invoked in section 4) is the code-enforced boundary that filters any prejudicial content before it can reach the reviewer — it rejects: verdict assignments, prior run references, historical pass/fail rates, executor reasoning leakage.

**Evidence — Layer 3 (forked context)**:

Both skills declare `context: fork` in their frontmatter, ensuring each runs in a fresh forked context with no shared conversation history.

The two skills (`acceptance-test-executor` and `acceptance-test-reviewer`) are distinct files with distinct identities, different tool grants, and different invocation roles. They cannot be the same agent.

**Verdict: PASS**

---

### C-04 — Doctor schema version check is dynamic (CRITICAL: PASS)

**Claim**: The `doctor` command imports `SCHEMA_VERSION` from `domain-store.mjs` rather than embedding a hardcoded literal.

**Evidence**: `install.mjs` line 893:

```js
const { SCHEMA_VERSION: codeVer } = await import("./lib/domain-store.mjs");
```

This is a live dynamic import of the exported constant. Any bump to `SCHEMA_VERSION` in `domain-store.mjs` is automatically reflected in doctor without a separate code change. There is no numeric literal in the doctor block that could drift from the actual version.

**Verdict: PASS**

---

### C-05 — SCHEMA_VERSION exported from domain-store.mjs (CRITICAL: PASS)

**Evidence**: `lib/domain-store.mjs` line 76:

```js
export const SCHEMA_VERSION = 3;
```

Named export, aligned to migration 003 (the highest-versioned migration under `lib/migrations/`). The inline comment (lines 70–76) explains the invariant: this constant must track the highest migration version; a stale value here would lock the store out of a freshly-migrated database.

**Verdict: PASS**

---

### M-01 — SQLite degradation path untested (MEDIUM: OPEN)

**Claim**: When `better-sqlite3` fails to load, the store degrades to JSON-only mode cleanly.

**Code path** (correct from inspection): `domain-store.mjs` lines 51–67 wrap the `require('better-sqlite3')` in a try/catch, leaving `Database = null` on failure. The constructor (line 196) only calls `_initDb()` when `Database` is non-null. All `_dbInsert`/`_dbUpdate` methods guard with `if (!this._sqliteAvailable) return;`. The fallback is structurally sound.

**Gap**: `domain-store.test.mjs` asserts `store.mode === "sqlite+json"` (line 72) in the happy path but no test mocks the load failure to assert JSON-only behavior. REQ-005 L2-6 acknowledges this: "Mock-path test is missing; criterion cannot be checked off from tests alone."

This is a coverage gap, not a code defect. The degradation logic is correct, but it has no automated regression protection. A future refactor could silently break it.

**Severity**: MEDIUM — code is correct, claim is code-verified, but the absence of a test means a refactor risk.

---

### M-02 — Dual-write order not asserted by test (MEDIUM: OPEN)

**Code inspection**: The ordering is structurally guaranteed by synchronous execution (lines 415 and 422 in `create()`). There is no async boundary and no callback between the two writes.

**Gap**: `domain-store.test.mjs` verifies dual-write *consistency* (lines 92–112: same column values in index and JSON) but does not intercept or sequence the writes to assert JSON precedes SQLite. REQ-005 L2-10 marks this partial: "ordering is inferred from source code and the atomicity tests."

A snapshot-based or `beforeEach` intercept test could assert that the JSON file exists before the SQLite `INSERT` completes. That test does not exist.

**Severity**: MEDIUM — ordering is verified by static code inspection; test gap means no automated regression guard on ordering.

---

### M-03 — runs_by_status oracle routing ambiguity (MEDIUM: OPEN)

**Finding**: `routeQuestion` in `lib/oracle-queries.mjs` has filter-based overrides for six query routes (lines 242–260) but no override for `status`+`runs`. A caller passing `{ status: "running" }` with a question like "show me running runs" relies on keyword scoring alone.

`runs_by_status` keywords: `["runs", "status", "running", "passed", "failed", "error"]` → score 2 for "show me running runs".
`recent_runs` keywords: `["recent", "last", "runs", "latest", "show"]` → score 2 for "show me running runs".

When two queries tie at the same keyword score, the winner is determined by iteration order of `Object.entries(scores)` — effectively undefined (depends on insertion order of `QUERIES`). A tie on "show running runs" could route to `recent_runs` (which takes a `limit` parameter, not a `status` parameter), causing `null` to bind into `LIMIT ?`.

This is a routing quality issue, not a SQL injection vector. However, a misrouted query would silently return wrong results rather than failing loudly.

**Severity**: MEDIUM — routing quality defect; no security impact; incorrect results possible for ambiguous phrasing.

---

### L-01 — vault_payload_sha not auto-wired in acceptance pipeline (LOW: OPEN)

**Finding**: `domain-store.mjs` lines 104–119 document a known gap: callers must pass `vault_payload_sha` explicitly; the acceptance-test-executor does not call `vault.record()` and does not auto-populate the SHA. The gap is acknowledged, scoped as a follow-on task, and the column is nullable with a defined default (NULL for pre-absorption verdicts).

This is a documented gap, not an undiscovered defect. The dual bus event (`wicked.test.evidence.captured`) fires only when `vault_payload_sha` is non-null; without auto-wiring, vault-linked evidence is not automatically captured in the pipeline.

**Severity**: LOW — acknowledged gap with a clear remediation path; no data loss; backward-compatible.

---

### L-02 — Scenario step-3 query count check is loose (LOW: PASS)

**Finding**: `scenarios/test-runner.md` step-3 guard: `if (Object.keys(m.QUERIES).length < 12) { process.exit(1); }`. This accepts any count >= 12, not exactly 13. With 13 queries currently in place, the assertion passes correctly. If a future query is removed and the count drops to 12, the assertion does not catch it.

**Mitigating control**: `oracle-queries.test.mjs` test "ships exactly the 13 documented named queries — no more, no fewer" (noted in REQ-005 L2-7) uses an exact equality check at the unit level.

**Severity**: LOW — the scenario assertion is weaker than the unit test; the unit test is the stronger regression guard and passes.

---

## Migration Correctness

Verified:

| File | Version | Method | Notes |
|------|---------|--------|-------|
| `001_initial.sql` | v1 | Full 7-table schema + `INSERT OR IGNORE` into `schema_migrations` | Safe; runner also uses `OR IGNORE` |
| `002_verdict_check_and_equivalence.sql` | v2 | 12-step table redefinition to add CHECK constraint + `equivalence_json` | Pure DDL; runner records version row |
| `003_vault_evidence_sha.sql` | v3 | `ALTER TABLE verdicts ADD COLUMN vault_payload_sha TEXT` | Pure DDL; runner records version row |

`lib/migrate.mjs`:
- Self-creates `schema_migrations` (idempotent `CREATE TABLE IF NOT EXISTS`).
- Applies migrations in lexicographic sort (= numeric order for 3-digit prefixes).
- Each migration runs inside its own `db.transaction()` — mid-migration failure leaves DB untouched.
- Both the legacy `001` self-insert and the runner's `INSERT OR IGNORE` are safe: one wins, version 1 is recorded exactly once.

No gaps (001→002→003 is sequential), no duplicate version numbers, no out-of-order risk.

---

## Skill Frontmatter Accuracy

**Plugin manifest**: `.claude-plugin/plugin.json` reports v0.9.0, 48 skills. `npm run prepublishOnly` exits 0 (confirmed in REQ-005 L1-5). The 49th directory (`wicked-vault/`) is a namespace directory without a top-level `SKILL.md` and is correctly excluded by the sync script.

**Frontmatter audit**:
- 40 skills carry `tier: 1` or `tier: 2` and `context: fork` (matches 15 Tier-1 + 25 Tier-2 per REQ-005 L1-3/L1-7).
- 8 workflow entry-point skills have no `tier` or `context` frontmatter field (confirmed: `plan`, `authoring`, `execution`, `acceptance-testing`, `review`, `insight`, `setup`, `update`).
- `acceptance-test-reviewer` frontmatter claims `allowed-tools: Read` → verified; body enforces evidence-only evaluation matching the claim.
- `acceptance-test-executor` frontmatter claims `allowed-tools: Read, Write, Bash` → verified; body instructs mechanical execution without judgment, consistent with the claim.

No frontmatter inconsistencies found.

---

## Reviewer Notes

1. The `runs_by_status` routing ambiguity (M-03) is the highest-risk OPEN finding from a user-experience standpoint. Adding a filter-override branch (`filters.status && (lower.includes("run") || lower.includes("status"))` → `"runs_by_status"`) would eliminate the keyword-tie risk.

2. The SQLite degradation coverage gap (M-01) is the highest-risk OPEN finding from a regression standpoint. A test using `proxyquire` or a manual `Database = null` injection into the module under test would close it.

3. The L3-3 release gate (adversarial review sign-off) is satisfied by this document. L3-4 through L3-7 remain deferred per REQ-005 and are outside the scope of this review.
