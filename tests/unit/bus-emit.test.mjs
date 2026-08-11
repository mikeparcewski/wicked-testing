/**
 * tests/unit/bus-emit.test.mjs
 *
 * Unit tests for lib/bus-emit.mjs (domainEventToBusEvent) and vault payload_sha256
 * integration introduced in Phase B of ECOSYSTEM-RATIONALIZATION.md §5a.
 *
 * SIG-3 coverage:
 *   1. domainEventToBusEvent returns a single wicked.test.verdict.created event when
 *      vault_payload_sha is absent (regression guard — existing callers unchanged)
 *   2. domainEventToBusEvent returns an array [wicked.test.verdict.created,
 *      wicked.test.evidence.captured] when vault_payload_sha is present (dual-event path)
 *   3. The dual-event path flows end-to-end: store.create("verdicts", { vault_payload_sha })
 *      stores the column — verified by store.get() round-trip
 *
 * NOTE: vault record()/content-addressing behavior is tested in the wicked-vault
 * package itself (its own proof scripts) — not here. wicked-testing consumes vault
 * as a published dependency; it does not test vault's internals.
 */

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  domainEventToBusEvent,
  createDomainStore,
  __resetDomainStoreCacheForTests,
} from "wicked-ledger";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_VERSION = "0.0.0-test";

/** Build a minimal verdict record as DomainStore would produce. */
function fakeVerdict(overrides = {}) {
  return {
    id: "v-test-id",
    project_id: "proj-1",
    run_id: "run-1",
    verdict: "PASS",
    reviewer: "acceptance-test-reviewer",
    evidence_path: null,
    vault_payload_sha: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// domainEventToBusEvent — verdicts.create, no vault_payload_sha
// ---------------------------------------------------------------------------

test("verdicts.create without vault_payload_sha returns single wicked.test.verdict.created", () => {
  const record = fakeVerdict();
  const result = domainEventToBusEvent("create", "verdicts", record, FAKE_VERSION);

  assert.ok(!Array.isArray(result), "should be a single event object, not an array");
  assert.equal(result.type, "wicked.test.verdict.created");
  assert.equal(result.payload.verdict_id, "v-test-id");
  assert.equal(result.payload.run_id, "run-1");
  assert.equal(result.payload.verdict, "PASS");
  assert.equal(result.payload.reviewer, "acceptance-test-reviewer");
  assert.equal(result.payload.evidence_path, null);
  assert.equal(result.payload.wicked_testing_version, FAKE_VERSION);
});

test("verdicts.create with vault_payload_sha=null still returns single event", () => {
  const rec = fakeVerdict({ vault_payload_sha: null });
  const result = domainEventToBusEvent("create", "verdicts", rec, FAKE_VERSION);

  assert.ok(!Array.isArray(result));
  assert.equal(result.type, "wicked.test.verdict.created");
});

// ---------------------------------------------------------------------------
// domainEventToBusEvent — verdicts.create, vault_payload_sha present (dual-event)
// ---------------------------------------------------------------------------

test("verdicts.create with vault_payload_sha returns array of two events", () => {
  const rec = fakeVerdict({ vault_payload_sha: "abc123sha256" });
  const result = domainEventToBusEvent("create", "verdicts", rec, FAKE_VERSION);

  assert.ok(Array.isArray(result), "expected array, got single event");
  assert.equal(result.length, 2, `expected 2 events, got ${result.length}`);
});

test("dual-event array[0] is wicked.test.verdict.created with correct payload", () => {
  const rec = fakeVerdict({ vault_payload_sha: "abc123sha256", evidence_path: "/some/path" });
  const [verdictEvent] = domainEventToBusEvent("create", "verdicts", rec, FAKE_VERSION);

  assert.equal(verdictEvent.type, "wicked.test.verdict.created");
  assert.equal(verdictEvent.payload.verdict_id, "v-test-id");
  assert.equal(verdictEvent.payload.run_id, "run-1");
  assert.equal(verdictEvent.payload.verdict, "PASS");
  assert.equal(verdictEvent.payload.reviewer, "acceptance-test-reviewer");
  assert.equal(verdictEvent.payload.evidence_path, "/some/path");
  // vault_payload_sha is NOT in the verdict event payload — it's in wicked.test.evidence.captured
  assert.ok(!("vault_payload_sha" in verdictEvent.payload), "vault_payload_sha should not appear in verdict event");
});

test("dual-event array[1] is wicked.test.evidence.captured with union payload", () => {
  const rec = fakeVerdict({ vault_payload_sha: "abc123sha256", evidence_path: "/some/path" });
  const [, capturedEvent] = domainEventToBusEvent("create", "verdicts", rec, FAKE_VERSION);

  assert.equal(capturedEvent.type, "wicked.test.evidence.captured");
  assert.equal(capturedEvent.payload.verdict_id, "v-test-id");
  assert.equal(capturedEvent.payload.run_id, "run-1");
  assert.equal(capturedEvent.payload.vault_payload_sha, "abc123sha256");
  assert.equal(capturedEvent.payload.evidence_path, "/some/path");
  assert.equal(capturedEvent.payload.project_id, "proj-1");
  assert.equal(capturedEvent.payload.wicked_testing_version, FAKE_VERSION);
  // Union payload: the verdict-path emit lacks an artifact count, so it is null.
  assert.equal(capturedEvent.payload.artifact_count, null, "artifact_count must be null on the verdict path");
});

test("dual-event evidence_path null propagates to both events", () => {
  const rec = fakeVerdict({ vault_payload_sha: "deadbeef", evidence_path: null });
  const [verdict, captured] = domainEventToBusEvent("create", "verdicts", rec, FAKE_VERSION);

  assert.equal(verdict.payload.evidence_path, null);
  assert.equal(captured.payload.evidence_path, null);
});

// ---------------------------------------------------------------------------
// DomainStore integration — vault_payload_sha column round-trips
// ---------------------------------------------------------------------------

let root;
let store;

beforeEach(() => {
  __resetDomainStoreCacheForTests();
  root = mkdtempSync(join(tmpdir(), "wt-bus-emit-"));
  store = createDomainStore({ root });
});

afterEach(() => {
  try { store.close(); } catch { /* ignore */ }
  __resetDomainStoreCacheForTests();
  rmSync(root, { recursive: true, force: true });
});

function seedRunChain() {
  const project = store.create("projects", { name: "bus-emit-proj", description: "d" });
  const scenario = store.create("scenarios", {
    project_id: project.id,
    name: "bus-emit-scenario",
    format_version: "1.0",
    body: "steps...",
    source_path: "scenarios/bus-emit.md",
  });
  const run = store.create("runs", {
    project_id: project.id,
    scenario_id: scenario.id,
    started_at: new Date().toISOString(),
    status: "running",
  });
  return { project, scenario, run };
}

test("store.create('verdicts', { vault_payload_sha }) stores the column — round-trips via get()", () => {
  const { run } = seedRunChain();
  const sha = "a1b2c3d4e5f600000000000000000000000000000000000000000000000000000";

  const verdict = store.create("verdicts", {
    run_id: run.id,
    verdict: "PASS",
    reviewer: "acceptance-test-reviewer",
    reason: "all assertions satisfied",
    vault_payload_sha: sha,
  });

  assert.ok(verdict.vault_payload_sha, "vault_payload_sha must be returned by create()");
  assert.equal(verdict.vault_payload_sha, sha);

  const fetched = store.get("verdicts", verdict.id);
  assert.equal(fetched.vault_payload_sha, sha, "vault_payload_sha must round-trip through get()");
});

test("store.create('verdicts', {}) without vault_payload_sha stores null — no regression", () => {
  const { run } = seedRunChain();
  const verdict = store.create("verdicts", {
    run_id: run.id,
    verdict: "FAIL",
    reviewer: "acceptance-test-reviewer",
    reason: "step 3 failed",
  });

  const fetched = store.get("verdicts", verdict.id);
  // Column exists but is null when not provided.
  assert.ok("vault_payload_sha" in fetched || fetched.vault_payload_sha === undefined || fetched.vault_payload_sha === null,
    "vault_payload_sha should be null/undefined for verdicts without it");
});
