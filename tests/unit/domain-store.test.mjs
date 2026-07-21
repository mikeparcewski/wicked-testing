/**
 * tests/unit/domain-store.test.mjs
 *
 * Trust-module test for the SQLite ledger / DomainStore (lib/domain-store.mjs).
 *
 * Asserts:
 *   - a project → scenario → run → verdict round-trips through create/get/list
 *   - dual-write consistency: the SQLite index row and the canonical JSON file
 *     agree on every field (the store's core invariant)
 *   - the verdict taxonomy is preserved end-to-end — an INCONCLUSIVE verdict's
 *     run carries status 'inconclusive', NOT 'failed' (covers P0 / item 1:
 *     "couldn't evaluate" must never be conflated with a true FAIL)
 *   - soft-delete hides rows from get/list in both index and JSON
 *
 * All state lives under a per-test tmp dir; no live ledger is touched.
 */

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DomainStore,
  createDomainStore,
  __resetDomainStoreCacheForTests,
} from "../../lib/domain-store.mjs";

let root;
let store;

beforeEach(() => {
  __resetDomainStoreCacheForTests();
  root = mkdtempSync(join(tmpdir(), "wt-ds-"));
  store = createDomainStore({ root });
});

afterEach(() => {
  try { store.close(); } catch { /* ignore */ }
  __resetDomainStoreCacheForTests();
  rmSync(root, { recursive: true, force: true });
});

// Read the canonical JSON file for a record directly off disk (bypasses the
// store) so we can compare it against what get() (index-first) returns.
function readJsonRecord(source, id) {
  const path = join(root, source, `${id}.json`);
  assert.ok(existsSync(path), `expected canonical JSON at ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

// Build the project → scenario → run chain a verdict needs (FK-valid).
function seedRunChain() {
  const project = store.create("projects", { name: "demo-proj", description: "d" });
  const scenario = store.create("scenarios", {
    project_id: project.id,
    name: "demo-scenario",
    format_version: "1.0",
    body: "steps...",
    source_path: "scenarios/demo.md",
  });
  const run = store.create("runs", {
    project_id: project.id,
    scenario_id: scenario.id,
    started_at: new Date().toISOString(),
    status: "running",
  });
  return { project, scenario, run };
}

test("runs in SQLite mode in this environment (dual-write under test)", () => {
  assert.equal(store.mode, "sqlite+json", "expected better-sqlite3 to load for full dual-write coverage");
});

test("round-trips a run + verdict through create/get", () => {
  const { run } = seedRunChain();
  const verdict = store.create("verdicts", {
    run_id: run.id,
    verdict: "PASS",
    reviewer: "acceptance-test-reviewer",
    reason: "all assertions satisfied",
  });

  const gotRun = store.get("runs", run.id);
  const gotVerdict = store.get("verdicts", verdict.id);
  assert.equal(gotRun.id, run.id);
  assert.equal(gotVerdict.verdict, "PASS");
  assert.equal(gotVerdict.run_id, run.id);
  assert.equal(gotVerdict.reviewer, "acceptance-test-reviewer");
});

test("dual-write consistency: SQLite index row equals canonical JSON", () => {
  const { run } = seedRunChain();
  const verdict = store.create("verdicts", {
    run_id: run.id,
    verdict: "FAIL",
    reviewer: "acceptance-test-reviewer",
    reason: "assertion step-2 unsatisfied",
  });

  // get() reads index-first (SQLite); readJsonRecord() reads canonical JSON.
  const fromIndex = store.get("verdicts", verdict.id);
  const fromJson = readJsonRecord("verdicts", verdict.id);

  for (const col of ["id", "run_id", "verdict", "reviewer", "reason", "created_at", "updated_at"]) {
    assert.equal(
      String(fromIndex[col]),
      String(fromJson[col]),
      `dual-write drift on column '${col}': index=${fromIndex[col]} json=${fromJson[col]}`
    );
  }
});

test("update propagates to BOTH the index and the JSON (no drift)", () => {
  const { run } = seedRunChain();
  store.update("runs", run.id, { status: "passed", finished_at: new Date().toISOString() });

  const fromIndex = store.get("runs", run.id);
  const fromJson = readJsonRecord("runs", run.id);
  assert.equal(fromIndex.status, "passed");
  assert.equal(fromJson.status, "passed");
  assert.equal(fromIndex.finished_at, fromJson.finished_at);
});

// --- P0 / item 1 regression: verdict taxonomy preserved, not collapsed ---

test("INCONCLUSIVE verdict's run keeps status 'inconclusive' — NOT 'failed'", () => {
  const { run } = seedRunChain();

  // This mirrors the orchestrator's 1:1 mapping from the acceptance SKILL.
  const VERDICT_TO_STATUS = {
    PASS: "passed", FAIL: "failed", PARTIAL: "partial", INCONCLUSIVE: "inconclusive",
  };
  const reviewerVerdict = "INCONCLUSIVE";

  store.update("runs", run.id, {
    finished_at: new Date().toISOString(),
    status: VERDICT_TO_STATUS[reviewerVerdict],
  });
  const verdict = store.create("verdicts", {
    run_id: run.id,
    verdict: reviewerVerdict,
    reviewer: "acceptance-test-reviewer",
    reason: "evidence missing — cannot evaluate",
  });

  const finalRun = store.get("runs", run.id);
  assert.equal(finalRun.status, "inconclusive");
  assert.notEqual(finalRun.status, "failed", "INCONCLUSIVE must NOT be conflated with a true FAIL");
  assert.equal(store.get("verdicts", verdict.id).verdict, "INCONCLUSIVE");

  // And the canonical JSON agrees.
  assert.equal(readJsonRecord("runs", run.id).status, "inconclusive");
});

test("PARTIAL verdict's run keeps status 'partial' — NOT 'failed'", () => {
  const { run } = seedRunChain();
  store.update("runs", run.id, { status: "partial", finished_at: new Date().toISOString() });
  assert.equal(store.get("runs", run.id).status, "partial");
  assert.notEqual(store.get("runs", run.id).status, "failed");
});

test("list filters by indexed column and excludes soft-deleted rows", () => {
  const project = store.create("projects", { name: "p", description: "d" });
  const sA = store.create("scenarios", { project_id: project.id, name: "a", format_version: "1.0" });
  store.create("scenarios", { project_id: project.id, name: "b", format_version: "1.0" });

  const all = store.list("scenarios", { project_id: project.id });
  assert.equal(all.length, 2);

  store.delete("scenarios", sA.id);
  const afterDelete = store.list("scenarios", { project_id: project.id });
  assert.equal(afterDelete.length, 1);
  assert.equal(afterDelete[0].name, "b");

  // Soft-deleted row is invisible to get() and marked deleted in JSON.
  assert.equal(store.get("scenarios", sA.id), null);
  assert.equal(readJsonRecord("scenarios", sA.id).deleted, 1);
});

test("stats counts agree with what was written", () => {
  const { run } = seedRunChain();
  store.create("verdicts", { run_id: run.id, verdict: "PASS", reviewer: "r" });
  const s = store.stats();
  assert.equal(s.mode, "sqlite+json");
  assert.equal(s.counts.projects, 1);
  assert.equal(s.counts.scenarios, 1);
  assert.equal(s.counts.runs, 1);
  assert.equal(s.counts.verdicts, 1);
});

test("rejects an unknown table name (allowlist guard)", () => {
  assert.throws(
    () => store.create("verdicts; DROP TABLE projects", { x: 1 }),
    (err) => err.code === "ERR_INVALID_SOURCE"
  );
});

// --- CONDITIONAL verdict (rec #1): now a legal enum value end-to-end ---
// Four Tier-2 agents (release-readiness, security, ai-feature, test-code-
// quality) emit CONDITIONAL. Migration 002 added it to the verdicts.verdict
// CHECK constraint, so the write must persist through the real store (which
// opens the DB with foreign_keys = ON and the CHECK active) — not silently
// fail the SQLite insert and drift to JSON-only.

test("a CONDITIONAL verdict persists through the store (CHECK constraint accepts it)", () => {
  const { run } = seedRunChain();
  store.update("runs", run.id, { status: "partial", finished_at: new Date().toISOString() });
  const verdict = store.create("verdicts", {
    run_id: run.id,
    verdict: "CONDITIONAL",
    reviewer: "release-readiness-engineer",
    reason: "ship with the two listed fixes",
  });

  // Index row + canonical JSON agree, and the row really landed in SQLite
  // (drift_count stays 0 — a CHECK rejection would have bumped it and the
  // index would diverge from JSON).
  const fromIndex = store.get("verdicts", verdict.id);
  const fromJson = readJsonRecord("verdicts", verdict.id);
  assert.equal(fromIndex.verdict, "CONDITIONAL");
  assert.equal(fromJson.verdict, "CONDITIONAL");
  assert.equal(store.stats().drift_count, 0, "CONDITIONAL must NOT trip the CHECK constraint (no SQLite drift)");
});

// --- Equivalence facet (rec #5): equivalence_json column round-trips ---

test("a verdict's equivalence_json (baseline-match facet) round-trips through index and JSON", () => {
  const { run } = seedRunChain();
  store.update("runs", run.id, { status: "partial", finished_at: new Date().toISOString() });
  const equivalence_json = JSON.stringify({
    baseline_ref: "tests/baselines/cart.json",
    baseline_sha: "a".repeat(64),
    method: "golden-master",
    diff_count: 0,
    tolerance: 0,
    matched: true,
  });
  const verdict = store.create("verdicts", {
    run_id: run.id,
    verdict: "CONDITIONAL",
    reviewer: "data-quality-tester",
    reason: "matched baseline within tolerance",
    equivalence_json,
  });

  const fromIndex = store.get("verdicts", verdict.id);
  const fromJson = readJsonRecord("verdicts", verdict.id);
  assert.equal(fromIndex.equivalence_json, equivalence_json, "equivalence_json must persist in the SQLite index");
  assert.equal(fromJson.equivalence_json, equivalence_json, "equivalence_json must persist in the canonical JSON");
  const eq = JSON.parse(fromIndex.equivalence_json);
  assert.equal(eq.matched, true);
  assert.equal(eq.method, "golden-master");
});

// --- MED-1 regression: an out-of-enum verdict fails LOUDLY and ATOMICALLY ---
// Before the fix, create() wrote canonical JSON first, then _dbInsert swallowed
// the CHECK-constraint failure (drift++ + stderr) — leaving the row in JSON but
// NOT in the index (split-brain: get() returns null while JSON says it exists).
// create() now validates the verdict against the enum (single source of truth,
// lib/manifest.mjs VERDICT_VALUES) BEFORE any write and throws, so neither
// store gets a dangling row.

test("an out-of-enum verdict throws and leaves NO split-brain (neither JSON nor index)", () => {
  const { run } = seedRunChain();
  const bogusId = "bogus-verdict-id";

  assert.throws(
    () => store.create("verdicts", {
      id: bogusId,
      run_id: run.id,
      verdict: "WONTFIX", // not in the enum
      reviewer: "some-agent",
      reason: "should never persist",
    }),
    (err) => err.code === "ERR_INVALID_VERDICT" && /WONTFIX/.test(err.message),
    "create() must throw a clear ERR_INVALID_VERDICT for an out-of-enum verdict"
  );

  // No canonical JSON file was written (atomic: the throw is BEFORE the write).
  const jsonPath = join(root, "verdicts", `${bogusId}.json`);
  assert.equal(existsSync(jsonPath), false, "no canonical JSON row may exist for a rejected verdict");

  // No index row either, and the failure did NOT register as drift (it was a
  // clean pre-write rejection, not a swallowed CHECK violation).
  assert.equal(store.get("verdicts", bogusId), null, "no index row may exist for a rejected verdict");
  assert.equal(store.stats().drift_count, 0, "a rejected verdict must not count as dual-write drift");
});

// --- L2-6: SQLite degradation path (DoD criterion) ---
// Verifies that DomainStore degrades cleanly to JSON-only mode when SQLite
// is unavailable — mode, create/list/stats all work; no crash or silent error.
// Simulates the `Database` module-load failure (better-sqlite3 missing/ABI
// mismatch) by subclassing DomainStore with a no-op _initDb(): the effect is
// identical — _sqliteAvailable stays false and _db stays null.

test("degrades to JSON-only mode when _initDb is a no-op (better-sqlite3 load failure sim)", () => {
  class JsonOnlyStore extends DomainStore {
    _initDb() { /* no-op: simulates better-sqlite3 failing to load */ }
  }

  let jsonOnlyRoot;
  let jsonOnlyStore;
  try {
    jsonOnlyRoot = mkdtempSync(join(tmpdir(), "wt-ds-json-"));
    jsonOnlyStore = new JsonOnlyStore(jsonOnlyRoot);

    // Mode must be json-only
    assert.equal(jsonOnlyStore.mode, "json-only",
      "store must report json-only mode when SQLite is unavailable");

    // create() must work (writes canonical JSON; no SQLite row)
    const project = jsonOnlyStore.create("projects", {
      name: "json-only-test-proj",
      description: "degradation test",
    });
    assert.ok(project.id, "create() must return a record with an id in json-only mode");

    // JSON file must exist on disk
    const jsonPath = join(jsonOnlyRoot, "projects", `${project.id}.json`);
    assert.ok(existsSync(jsonPath), "canonical JSON file must be written in json-only mode");

    // get() must find the record (JSON fallback)
    const fetched = jsonOnlyStore.get("projects", project.id);
    assert.ok(fetched, "get() must find the record via JSON in json-only mode");
    assert.equal(fetched.name, "json-only-test-proj");

    // list() must work (scans JSON files)
    const listed = jsonOnlyStore.list("projects");
    assert.equal(listed.length, 1, "list() must find the record in json-only mode");

    // stats() must return mode: json-only and a counts object
    const s = jsonOnlyStore.stats();
    assert.equal(s.mode, "json-only", "stats() must report json-only mode");
    assert.equal(typeof s.counts, "object", "stats() must include a counts object");
    assert.equal(s.counts.projects, 1, "stats() must count the JSON file in json-only mode");

  } finally {
    if (jsonOnlyStore) { try { jsonOnlyStore.close(); } catch { /* ignore */ } }
    if (jsonOnlyRoot) { rmSync(jsonOnlyRoot, { recursive: true, force: true }); }
  }
});

test("every valid verdict value (incl. CONDITIONAL) persists and reads back from BOTH stores", () => {
  const { run } = seedRunChain();
  const FULL_ENUM = ["PASS", "FAIL", "PARTIAL", "CONDITIONAL", "INCONCLUSIVE", "N-A", "SKIP"];

  for (const value of FULL_ENUM) {
    const v = store.create("verdicts", {
      run_id: run.id,
      verdict: value,
      reviewer: "acceptance-test-reviewer",
      reason: `value=${value}`,
    });
    const fromIndex = store.get("verdicts", v.id);
    const fromJson = readJsonRecord("verdicts", v.id);
    assert.ok(fromIndex, `index row must exist for verdict '${value}'`);
    assert.equal(fromIndex.verdict, value, `index verdict must be '${value}'`);
    assert.equal(fromJson.verdict, value, `canonical JSON verdict must be '${value}'`);
  }

  // All seven landed in the index with no drift — the CHECK accepted every
  // enum value and the pre-write guard let them all through.
  assert.equal(store.stats().drift_count, 0, "no valid verdict may trip the CHECK / cause drift");
  assert.equal(store.stats().counts.verdicts, FULL_ENUM.length, "every valid verdict must be indexed");
});
