/**
 * lib/gate.mjs — wicked-qe gate command implementation
 *
 * Records a gate verdict for a test run, writes to domain store, and emits
 * wicked-bus events per the wicked-qe REQ-001 / REQ-003 §4.2 contract.
 *
 * Bus event payload (8 canonical fields per REQ-003 §4.2):
 *   run_id, context, gate_verdict, exit_code, verdict_summary,
 *   mode, completed_at, scenario_count
 *
 * Exit codes:
 *   0  PASS
 *   1  FAIL
 *   2  CONDITIONAL
 *   3  SYSTEM_ERROR
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createDomainStore } from "./domain-store.mjs";

// Gate verdicts → domain store verdict enum.
// SYSTEM_ERROR has no direct domain-store mapping; INCONCLUSIVE is the closest
// semantic fit (the store rejects anything outside VERDICT_VALUES).
const VERDICT_TO_STORE_MAP = {
  PASS: "PASS",
  FAIL: "FAIL",
  CONDITIONAL: "CONDITIONAL",
  SYSTEM_ERROR: "INCONCLUSIVE",
};

const VALID_GATE_VERDICTS = ["PASS", "FAIL", "CONDITIONAL", "SYSTEM_ERROR"];

/**
 * Fire-and-forget wicked-bus emit.
 * Tries the wicked-bus binary directly first (fast path when installed globally),
 * then falls back to `npx wicked-bus` so it also works in dev / CI where only
 * the local npm tree has the binary. Never throws.
 */
function spawnBusEmit(type, domain, subdomain, payload, idempotencyKey) {
  const payloadStr = JSON.stringify(payload);
  const args = [
    "emit",
    "--type", type,
    "--domain", domain,
    "--subdomain", subdomain,
    "--payload", payloadStr,
  ];
  if (idempotencyKey) {
    args.push("--idempotency-key", idempotencyKey);
  }

  try {
    const r = spawnSync("wicked-bus", args, { stdio: "pipe", timeout: 5000 });
    if (!r.error || r.error.code !== "ENOENT") return; // success or non-ENOENT failure
  } catch { /* fall through to npx */ }

  // npx fallback (slower, but works without global install). On win32 invoke
  // `npx.cmd` directly with shell:false — shell:true would route the quoted
  // JSON `--payload` arg through cmd.exe, which re-parses the quotes/braces and
  // corrupts the payload. `.cmd` is the resolvable shim name when no shell runs.
  const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
  try {
    spawnSync(npxCmd, ["wicked-bus", ...args], { stdio: "pipe", timeout: 10000 });
  } catch { /* fire-and-forget — ignore */ }
}

/**
 * Read scenario counts from the evidence directory.
 *
 * Strategy (best-effort, never throws):
 *   1. Look for a gate-summary.json or manifest.json with aggregated counts.
 *   2. Fall back to counting *.json files that are not manifest/gate files.
 *   3. Return all zeros if the dir is empty or unreadable.
 */
function countScenarios(evidencePath) {
  const result = { scenario_count: 0, passed_count: 0, failed_count: 0 };
  if (!existsSync(evidencePath)) return result;

  // Try manifest.json — may carry aggregated counts for multi-scenario runs
  const manifestPath = join(evidencePath, "manifest.json");
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      // Aggregated counts (wicked-qe v2+ manifests)
      if (typeof manifest.scenario_count === "number") {
        result.scenario_count = manifest.scenario_count;
        result.passed_count = manifest.passed_count ?? 0;
        result.failed_count = manifest.failed_count ?? 0;
        return result;
      }
      // Single-scenario manifest (wicked-testing standard format)
      if (manifest.run_id) {
        result.scenario_count = 1;
        const v = manifest.verdict?.value;
        if (v === "PASS") result.passed_count = 1;
        else if (v === "FAIL") result.failed_count = 1;
        return result;
      }
    } catch { /* ignore parse errors — fall through */ }
  }

  // Fallback: count result JSON files (exclude manifest and gate artifacts)
  try {
    const files = readdirSync(evidencePath).filter(
      (f) => f.endsWith(".json") && f !== "manifest.json" && !f.startsWith("gate-")
    );
    result.scenario_count = files.length;
  } catch { /* ignore readdir errors */ }

  return result;
}

/**
 * Run the wicked-qe gate command.
 *
 * @param {object} opts
 * @param {string} opts.projectId        Project identifier
 * @param {string} opts.runId            Test run identifier
 * @param {string} opts.verdict          PASS|FAIL|CONDITIONAL|SYSTEM_ERROR
 * @param {string} opts.verdictSummary   Human-readable summary
 * @param {string} [opts.rationaleRef]   Path to rationale document
 * @param {string} [opts.councilRunId]   Council session ID
 */
export async function runGate({ projectId, runId, verdict, verdictSummary, rationaleRef, councilRunId, mode, dryRun = false }) {
  // 1. Validate verdict enum before touching anything
  if (!VALID_GATE_VERDICTS.includes(verdict)) {
    process.stderr.write(
      JSON.stringify({ error: "INVALID_VERDICT", verdict, valid: VALID_GATE_VERDICTS }) + "\n"
    );
    process.exit(3);
  }

  // 1b. Reject a runId that could escape the evidence directory. runId is
  //     interpolated straight into the evidence path below; a value containing
  //     a path separator, a '..' segment, or a NUL byte would let a caller
  //     read/write outside .wicked-testing/evidence/.
  if (
    runId.includes("/") ||
    runId.includes("\\") ||
    runId.includes("..") ||
    runId.includes("\0")
  ) {
    process.stderr.write(
      JSON.stringify({
        error: "INVALID_RUN_ID",
        run_id: runId,
        reason: "path separators, '..', and NUL are not allowed in --run-id",
      }) + "\n"
    );
    process.exit(3);
  }

  // 2. Validate evidence directory
  const evidencePath = join(".wicked-testing", "evidence", runId);
  if (!existsSync(evidencePath)) {
    process.stderr.write(
      JSON.stringify({ error: "EVIDENCE_NOT_FOUND", evidence_path: evidencePath }) + "\n"
    );
    process.exit(3);
  }

  // 3. Count scenarios from evidence (best-effort)
  const { scenario_count, passed_count, failed_count } = countScenarios(evidencePath);

  // Build idempotency key per DEC-00010: qe:gate.result:{context}:{sha256(run_id)[0:16]}:0
  const runIdHash = createHash("sha256").update(runId).digest("hex").slice(0, 16);
  const idempotencyKey = `qe:gate.result:${projectId}:${runIdHash}:0`;

  // 4. Validate the run exists, then write the gate verdict.
  //    A verdict.run_id is an FK into `runs`; DomainStore._dbInsert swallows an
  //    FK failure (drift_count++ + stderr) instead of throwing, so recording a
  //    verdict for a nonexistent run would leave a JSON-only *phantom* verdict
  //    AND still fire qe.gate.passed + qe.deploy.completed downstream. Guard:
  //    confirm the run exists BEFORE recording anything or emitting any event —
  //    if it's absent, fail loud and exit non-zero. Skipped in dry-run (nothing
  //    is recorded or emitted there, so there is no phantom to prevent).
  let store = null;
  if (!dryRun) {
    try {
      store = createDomainStore();
    } catch (err) {
      process.stderr.write(
        JSON.stringify({ error: "STORE_UNAVAILABLE", detail: err.message }) + "\n"
      );
      process.exit(3);
    }

    const run = store.get("runs", runId);
    if (!run) {
      // No such run — refuse to record a phantom verdict or emit gate/deploy
      // events for it. This is the P1 guard: exit before step 6/7.
      process.stderr.write(
        JSON.stringify({ error: "RUN_NOT_FOUND", run_id: runId }) + "\n"
      );
      try { store.close(); } catch { /* ignore close errors */ }
      process.exit(3);
    }

    // Run verified. Record the gate verdict. A failed *index* write still
    // degrades gracefully (canonical JSON is authoritative) — but the FK
    // phantom case is now impossible because the run was confirmed above.
    // councilRunId, when supplied, is persisted alongside any rationale_ref in
    // equivalence_json; the equivalence-facet reader drops non-facet metadata
    // gracefully (no matched/method keys), so this is a safe carrier column.
    try {
      const storeVerdict = VERDICT_TO_STORE_MAP[verdict] ?? "INCONCLUSIVE";
      const meta = {};
      if (rationaleRef) meta.rationale_ref = rationaleRef;
      if (councilRunId) meta.council_run_id = councilRunId;
      store.create("verdicts", {
        run_id: runId,
        verdict: storeVerdict,
        evidence_path: evidencePath,
        reviewer: "wicked-qe",
        reason: verdictSummary,
        ...(Object.keys(meta).length ? { equivalence_json: JSON.stringify(meta) } : {}),
      });
    } catch (err) {
      process.stderr.write(`[wicked-qe] domain store write failed (non-fatal): ${err.message}\n`);
      // continue — a store *write* failure must not abort the gate
    } finally {
      if (store) {
        try { store.close(); } catch { /* ignore close errors */ }
      }
    }
  }

  // 5. Build the 8-field canonical bus payload (REQ-003 §4.2)
  //    Field names and structure are governed by §4.2 — do not add extra fields here.
  const exitCodeMap = { PASS: 0, FAIL: 1, CONDITIONAL: 2 };
  const exitCode = exitCodeMap[verdict] ?? 3;

  const busPayload = {
    run_id: runId,
    context: projectId,
    gate_verdict: verdict,
    exit_code: exitCode,
    verdict_summary: verdictSummary,
    mode: mode || "gate",
    completed_at: new Date().toISOString(),
    scenario_count,
  };

  // 6. Emit gate bus event (fire-and-forget)
  //    SYSTEM_ERROR maps to wicked.qe.gate.conditional (per spec)
  //    domain=qe, subdomain=gate per REQ-003 §4.2 event catalog rows #8, #9, #10
  const gateEventType =
    verdict === "PASS" ? "wicked.qe.gate.passed" :
    verdict === "FAIL" ? "wicked.qe.gate.failed" :
    "wicked.qe.gate.conditional"; // CONDITIONAL and SYSTEM_ERROR

  if (!dryRun) {
    spawnBusEmit(gateEventType, "qe", "gate", busPayload, idempotencyKey);

    // 7. On PASS, emit cross-product deploy signal (wicked. prefix required for wildcard subscribers)
    if (verdict === "PASS") {
      spawnBusEmit("wicked.qe.deploy.completed", "qe", "deploy", {
        run_id: runId,
        project_id: projectId,
      });
    }
  }

  // 8. Output canonical result JSON to stdout
  const output = {
    run_id: runId,
    project_id: projectId,
    gate_verdict: verdict,
    verdict_summary: verdictSummary,
    scenario_count,
    passed_count,
    failed_count,
    evidence_path: evidencePath,
  };
  process.stdout.write(JSON.stringify(output) + "\n");

  // 9. Exit with verdict-mapped code (exitCode computed in step 5)
  process.exit(exitCode);
}
