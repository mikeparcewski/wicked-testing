/**
 * lib/manifest.mjs — builds the public evidence manifest.
 *
 * Writes `.wicked-testing/evidence/<run-id>/manifest.json` per the contract
 * in docs/EVIDENCE.md and schemas/evidence.json. The manifest is the one
 * artifact downstream consumers (wicked-garden crew gates, dashboards) read —
 * everything else in the evidence dir is referenced from the `artifacts[]`
 * entry in the manifest and never read directly.
 *
 * Input is the DomainStore records for the run; output is the manifest
 * object AND the path it was written to. Runs a minimal shape validation
 * before writing so we fail loud on schema drift.
 */

import { readFileSync, writeFileSync, statSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { platform, release } from "node:os";

export const MANIFEST_VERSION = "1.0.0";

// Artifact kind classification. Every artifact ends up with a kind from this
// set because the schema's enum rejects anything else. Unknown extensions
// fall through to "misc" rather than being dropped.
const KIND_BY_EXT = {
  ".png": "screenshot", ".jpg": "screenshot", ".jpeg": "screenshot", ".gif": "screenshot",
  ".mp4": "video", ".webm": "video", ".mov": "video",
  ".log": "log",
  ".diff": "diff", ".patch": "diff",
};

function classifyArtifact(filename) {
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot) : "";
  if (KIND_BY_EXT[ext]) return KIND_BY_EXT[ext];
  if (lower.includes("stack") || lower.includes("traceback")) return "stack-trace";
  if (lower.includes("coverage") || lower.endsWith(".lcov") || lower.endsWith(".cobertura")) return "coverage";
  if (lower.includes("trace")) return "trace";
  if (lower.includes("metric")) return "metric";
  if (lower.includes("response") && lower.endsWith(".json")) return "http-response";
  if (lower.includes("request") && lower.endsWith(".json")) return "http-request";
  return "misc";
}

/**
 * @param {object} opts
 * @param {object} opts.runRecord      runs row: { id, project_id, scenario_id, started_at, finished_at, status, evidence_path }
 * @param {object} opts.scenarioRecord scenarios row: { id, name, source_path? }
 * @param {object} opts.verdictRecord  verdicts row: { verdict, reviewer, reason?, created_at }
 * @param {string} opts.evidenceDir    absolute path to the run's evidence dir
 * @param {string} opts.wickedTestingVersion  e.g. "0.2.0"
 * @param {string} [opts.cli]          optional host CLI name ("claude", "gemini", ...)
 * @param {string[]} [opts.excludeFiles] basenames to skip in the artifacts walk
 * @returns {{ manifest: object, path: string }}
 */
export function buildManifest({
  runRecord,
  scenarioRecord,
  verdictRecord,
  evidenceDir,
  wickedTestingVersion,
  cli,
  excludeFiles = ["manifest.json", "context.md"],
}) {
  if (!runRecord || !runRecord.id) throw new Error("buildManifest: runRecord.id required");
  if (!verdictRecord || !verdictRecord.verdict) throw new Error("buildManifest: verdictRecord.verdict required");
  if (!evidenceDir) throw new Error("buildManifest: evidenceDir required");

  mkdirSync(evidenceDir, { recursive: true });

  const artifacts = collectArtifacts(evidenceDir, excludeFiles);

  const started = runRecord.started_at ? new Date(runRecord.started_at).getTime() : null;
  const finished = runRecord.finished_at ? new Date(runRecord.finished_at).getTime() : null;
  const duration_ms = started !== null && finished !== null && finished >= started
    ? finished - started
    : 0;

  const manifest = {
    manifest_version: MANIFEST_VERSION,
    run_id: runRecord.id,
    project_id: runRecord.project_id,
    scenario_id: runRecord.scenario_id,
    scenario_name: scenarioRecord?.name ?? "unknown",
    ...(scenarioRecord?.source_path ? { scenario_path: scenarioRecord.source_path } : {}),
    started_at: runRecord.started_at,
    finished_at: runRecord.finished_at,
    duration_ms,
    status: runRecord.status || "errored",
    verdict: {
      value: verdictRecord.verdict,
      reviewer: verdictRecord.reviewer || "unknown",
      ...(verdictRecord.reason ? { reason: verdictRecord.reason } : {}),
      recorded_at: verdictRecord.created_at || new Date().toISOString(),
    },
    environment: {
      os: `${platform()} ${release()}`,
      node: process.versions.node,
      ...(cli ? { cli } : {}),
      wicked_testing_version: wickedTestingVersion,
    },
    artifacts,
  };

  validateShape(manifest);

  const path = join(evidenceDir, "manifest.json");
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
  return { manifest, path };
}

function collectArtifacts(evidenceDir, excludeFiles) {
  if (!existsSync(evidenceDir)) return [];
  const out = [];
  for (const name of readdirSync(evidenceDir)) {
    if (excludeFiles.includes(name)) continue;
    const full = join(evidenceDir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (!st.isFile()) continue;
    let content;
    try { content = readFileSync(full); } catch { continue; }
    const sha = createHash("sha256").update(content).digest("hex");
    out.push({
      name,
      kind: classifyArtifact(name),
      path: name,
      bytes: st.size,
      sha256: sha,
      captured_at: new Date(st.mtimeMs).toISOString(),
    });
  }
  return out;
}

// Minimal shape check against schemas/evidence.json required fields. Not a
// full JSON-schema validator — just asserts top-level keys are present and
// types look right. Keeps us honest without adding an ajv dependency.
function validateShape(m) {
  const required = [
    "manifest_version", "run_id", "project_id", "scenario_id", "scenario_name",
    "started_at", "finished_at", "duration_ms", "status", "verdict",
    "environment", "artifacts",
  ];
  for (const k of required) {
    if (!(k in m)) throw new Error(`manifest: missing required field '${k}'`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(m.manifest_version)) throw new Error("manifest: invalid manifest_version");
  if (!["passed", "failed", "errored", "skipped"].includes(m.status)) throw new Error(`manifest: invalid status '${m.status}'`);
  if (!["PASS", "FAIL", "N-A", "SKIP"].includes(m.verdict.value)) throw new Error(`manifest: invalid verdict.value '${m.verdict.value}'`);
  if (!Array.isArray(m.artifacts)) throw new Error("manifest: artifacts must be array");
  for (const a of m.artifacts) {
    for (const k of ["name", "kind", "path", "bytes", "sha256", "captured_at"]) {
      if (!(k in a)) throw new Error(`manifest: artifact missing '${k}'`);
    }
  }
}
