/**
 * tests/unit/manifest.test.mjs
 *
 * Trust-module test for the public evidence manifest builder (lib/manifest.mjs).
 *
 * Covers the two contract-widening changes this release makes to the manifest
 * (which is the one artifact downstream consumers read):
 *
 *   1. `CONDITIONAL` is now a legal verdict value. Four Tier-2 agents already
 *      emit it; before this change buildManifest()'s validateShape() threw
 *      `invalid verdict.value 'CONDITIONAL'` the first time a manifest was
 *      built off such a run. This proves it now passes.
 *
 *   2. The optional `verdict.equivalence` facet (baseline-match provenance)
 *      flows through buildManifest from either input form — a plain
 *      `equivalence` object OR the DB-column `equivalence_json` string — and
 *      lands on the manifest. A malformed/incomplete facet is dropped (the
 *      field is optional and a broken sidecar must not sink the manifest).
 *
 * validateShape is private; it's exercised through buildManifest (which calls
 * it before writing). buildManifest writes manifest.json to disk, so each case
 * uses a throwaway tmp evidence dir.
 */

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildManifest, MANIFEST_VERSION } from "wicked-ledger";

let evidenceDir;

beforeEach(() => {
  evidenceDir = mkdtempSync(join(tmpdir(), "wt-manifest-"));
});

afterEach(() => {
  rmSync(evidenceDir, { recursive: true, force: true });
});

// Minimal valid run/scenario records for buildManifest.
function records(verdictOverrides = {}) {
  return {
    runRecord: {
      id: "run-1",
      project_id: "proj-1",
      scenario_id: "scn-1",
      started_at: "2026-06-01T00:00:00.000Z",
      finished_at: "2026-06-01T00:00:03.000Z",
      status: "partial",
    },
    scenarioRecord: { id: "scn-1", name: "cart-checkout-equivalence", source_path: "scenarios/cart.md" },
    verdictRecord: {
      verdict: "CONDITIONAL",
      reviewer: "release-readiness-engineer",
      reason: "ship with the two listed fixes",
      created_at: "2026-06-01T00:00:03.000Z",
      ...verdictOverrides,
    },
    evidenceDir,
    wickedTestingVersion: "0.5.0",
  };
}

test("manifest_version is the 1.1.x minor bump (equivalence facet added)", () => {
  assert.match(MANIFEST_VERSION, /^1\.1\.\d+$/, `expected a 1.1.x manifest version, got ${MANIFEST_VERSION}`);
});

test("a CONDITIONAL verdict passes validateShape and is written to the manifest", () => {
  const { manifest, path } = buildManifest(records());
  assert.equal(manifest.verdict.value, "CONDITIONAL", "CONDITIONAL must survive validateShape");
  assert.equal(manifest.status, "partial");
  assert.ok(existsSync(path), "manifest.json must be written");
  // And it round-trips from disk (validateShape didn't throw and write happened).
  const onDisk = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(onDisk.verdict.value, "CONDITIONAL");
});

test("equivalence facet supplied as a plain object lands on verdict.equivalence", () => {
  const { manifest } = buildManifest(
    records({
      equivalence: {
        baseline_ref: "tests/baselines/cart.json",
        baseline_sha: "a".repeat(64),
        method: "golden-master",
        diff_count: 0,
        tolerance: 0,
        matched: true,
      },
    })
  );
  const eq = manifest.verdict.equivalence;
  assert.ok(eq, "verdict.equivalence must be present");
  assert.equal(eq.method, "golden-master");
  assert.equal(eq.matched, true);
  assert.equal(eq.diff_count, 0);
  assert.equal(eq.baseline_ref, "tests/baselines/cart.json");
  assert.equal(eq.baseline_sha, "a".repeat(64));
});

test("equivalence facet supplied as equivalence_json (DB column) is parsed onto the manifest", () => {
  const equivalence_json = JSON.stringify({
    method: "reconciliation",
    matched: false,
    diff_count: 3,
    tolerance: 0,
  });
  const { manifest } = buildManifest(records({ verdict: "FAIL", equivalence_json }));
  const eq = manifest.verdict.equivalence;
  assert.ok(eq, "verdict.equivalence must be parsed from equivalence_json");
  assert.equal(eq.method, "reconciliation");
  assert.equal(eq.matched, false);
  assert.equal(eq.diff_count, 3);
});

test("verdict with NO equivalence facet omits the field entirely (backward-compatible)", () => {
  const { manifest } = buildManifest(records({ verdict: "PASS" }));
  assert.equal("equivalence" in manifest.verdict, false, "absent facet must not appear on the verdict");
});

test("a malformed equivalence_json string is dropped, not thrown (broken sidecar must not sink the manifest)", () => {
  // Invalid JSON — normalizeEquivalence swallows the parse error and omits.
  const { manifest } = buildManifest(records({ verdict: "PASS", equivalence_json: "{not valid json" }));
  assert.equal("equivalence" in manifest.verdict, false, "unparseable facet is dropped silently");
});

test("an equivalence facet missing required keys is dropped (matched/method required by schema)", () => {
  // No `matched`, no valid `method` → normalizeEquivalence returns null.
  const { manifest } = buildManifest(records({ verdict: "PASS", equivalence: { diff_count: 0 } }));
  assert.equal("equivalence" in manifest.verdict, false, "incomplete facet must be dropped");
});

test("an equivalence facet with an out-of-enum method is dropped before it can fail validateShape", () => {
  // method not in the closed set; normalizeEquivalence rejects it so validateShape never sees it.
  const { manifest } = buildManifest(
    records({ verdict: "PASS", equivalence: { method: "fuzzy-vibes", matched: true } })
  );
  assert.equal("equivalence" in manifest.verdict, false, "bad-method facet must be dropped, manifest still valid");
});

// --- NIT-4: producer-enforced invariant matched === (diff_count <= tolerance) ---

test("an equivalence facet whose matched contradicts diff_count<=tolerance is dropped", () => {
  // diff_count(3) > tolerance(0) but matched:true — self-contradictory; the
  // facet is the verdict-of-record for equivalence, so a misleading one is
  // worse than none. normalizeEquivalence drops it (consistent with its other
  // drop-malformed paths) rather than persisting the contradiction.
  const { manifest } = buildManifest(
    records({ verdict: "PASS", equivalence: { method: "golden-master", matched: true, diff_count: 3, tolerance: 0 } })
  );
  assert.equal("equivalence" in manifest.verdict, false, "contradictory facet must be dropped");
});

test("a consistent equivalence facet (matched === diff_count<=tolerance) is kept", () => {
  // diff_count(2) <= tolerance(5) and matched:true — consistent; kept.
  const { manifest } = buildManifest(
    records({ verdict: "PASS", equivalence: { method: "perceptual", matched: true, diff_count: 2, tolerance: 5 } })
  );
  const eq = manifest.verdict.equivalence;
  assert.ok(eq, "a consistent facet must be kept");
  assert.equal(eq.matched, true);
  assert.equal(eq.diff_count, 2);
  assert.equal(eq.tolerance, 5);
});

// --- Gemini review: tolerance must be a FINITE number ---

test("a non-finite tolerance (Infinity) is rejected, not carried onto the facet", () => {
  // `typeof Infinity === "number"` and `Infinity >= 0` is true, so the old
  // `typeof`-based guard would have accepted it — making any diff_count appear
  // "within tolerance" — and Infinity serializes to null, violating the schema.
  // Number.isFinite rejects it: the tolerance field is simply omitted. With
  // tolerance gone the NIT-4 invariant (needs BOTH diff_count and tolerance)
  // does not fire, so the rest of the facet is kept.
  const { manifest } = buildManifest(
    records({ verdict: "PASS", equivalence: { method: "golden-master", matched: true, diff_count: 0, tolerance: Infinity } })
  );
  const eq = manifest.verdict.equivalence;
  assert.ok(eq, "the facet itself is still valid (matched + method present)");
  assert.equal("tolerance" in eq, false, "a non-finite tolerance must not land on the manifest");
  assert.equal(eq.diff_count, 0);
});

test("a NaN tolerance is rejected, not carried onto the facet", () => {
  const { manifest } = buildManifest(
    records({ verdict: "PASS", equivalence: { method: "perceptual", matched: true, diff_count: 1, tolerance: NaN } })
  );
  const eq = manifest.verdict.equivalence;
  assert.ok(eq, "the facet itself is still valid");
  assert.equal("tolerance" in eq, false, "a NaN tolerance must not land on the manifest");
});

test("an Infinity tolerance arriving via equivalence_json is dropped (JSON.parse yields null → not a finite number)", () => {
  // JSON has no Infinity literal; producers serialize it as null. Number.isFinite(null)
  // is false, so the tolerance is omitted regardless of the input form.
  const equivalence_json = JSON.stringify({ method: "contract", matched: true, diff_count: 0, tolerance: Infinity });
  const { manifest } = buildManifest(records({ verdict: "PASS", equivalence_json }));
  const eq = manifest.verdict.equivalence;
  assert.ok(eq, "facet parsed and kept");
  assert.equal("tolerance" in eq, false, "null-serialized non-finite tolerance must not land on the manifest");
});
