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
