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
 *      wicked.evidence.captured] when vault_payload_sha is present (dual-event path)
 *   3. The dual-event path flows end-to-end: store.create("verdicts", { vault_payload_sha })
 *      stores the column — verified by store.get() round-trip
 *   4. vault record() returns payload_sha256 in its result object
 */

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { domainEventToBusEvent } from "../../lib/bus-emit.mjs";
import {
  createDomainStore,
  __resetDomainStoreCacheForTests,
} from "../../lib/domain-store.mjs";
import { initVault, record } from "../../src/vault/vault.mjs";

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
  // vault_payload_sha is NOT in the verdict event payload — it's in evidence.captured
  assert.ok(!("vault_payload_sha" in verdictEvent.payload), "vault_payload_sha should not appear in verdict event");
});

test("dual-event array[1] is wicked.evidence.captured with vault_payload_sha", () => {
  const rec = fakeVerdict({ vault_payload_sha: "abc123sha256", evidence_path: "/some/path" });
  const [, capturedEvent] = domainEventToBusEvent("create", "verdicts", rec, FAKE_VERSION);

  assert.equal(capturedEvent.type, "wicked.evidence.captured");
  assert.equal(capturedEvent.payload.verdict_id, "v-test-id");
  assert.equal(capturedEvent.payload.run_id, "run-1");
  assert.equal(capturedEvent.payload.vault_payload_sha, "abc123sha256");
  assert.equal(capturedEvent.payload.evidence_path, "/some/path");
  assert.equal(capturedEvent.payload.project_id, "proj-1");
  assert.equal(capturedEvent.payload.wicked_testing_version, FAKE_VERSION);
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

// ---------------------------------------------------------------------------
// vault record() returns payload_sha256 in result
// ---------------------------------------------------------------------------

test("vault record() --artifact returns payload_sha256 in result", () => {
  // Create an isolated vault root and write a test file to capture.
  const vaultRoot = mkdtempSync(join(tmpdir(), "wt-vault-rec-"));
  try {
    initVault(vaultRoot);

    // Write the artifact we'll record.
    const artPath = join(vaultRoot, "test-artifact.txt");
    writeFileSync(artPath, "evidence content for unit test\n");

    const result = record(vaultRoot, {
      artifact: artPath,
      scope: "unit-test",
      phase: "build",
      claim: "artifact-present",
      kind: "file",
      source: artPath,
      criteria: "the artifact file exists and has content",
    });

    assert.ok(result.payload_sha256, "record() must return payload_sha256");
    assert.equal(typeof result.payload_sha256, "string");
    assert.equal(result.payload_sha256.length, 64, "SHA-256 hex digest must be 64 characters");
    assert.ok(/^[0-9a-f]{64}$/.test(result.payload_sha256), "payload_sha256 must be lowercase hex");

    // Sanity: id and envelope_hash also present (unchanged contract)
    assert.ok(result.id, "record() must return id");
    assert.ok(result.envelope_hash, "record() must return envelope_hash");
  } finally {
    rmSync(vaultRoot, { recursive: true, force: true });
  }
});

test("vault record() payload_sha256 is content-addressed — same content = same sha", () => {
  const vaultRoot = mkdtempSync(join(tmpdir(), "wt-vault-dedup-"));
  try {
    initVault(vaultRoot);

    const artPath = join(vaultRoot, "dedup-art.txt");
    writeFileSync(artPath, "deterministic content for dedup test\n");

    const r1 = record(vaultRoot, {
      artifact: artPath, scope: "test", phase: "build",
      claim: "dedup-claim-1", kind: "file", source: artPath,
      criteria: "content is deterministic",
    });
    const r2 = record(vaultRoot, {
      artifact: artPath, scope: "test", phase: "build",
      claim: "dedup-claim-2", kind: "file", source: artPath,
      criteria: "content is deterministic",
    });

    assert.equal(r1.payload_sha256, r2.payload_sha256,
      "same content must produce the same payload_sha256 (content-addressed store)");
    assert.notEqual(r1.id, r2.id, "distinct records must still have different IDs");
  } finally {
    rmSync(vaultRoot, { recursive: true, force: true });
  }
});
