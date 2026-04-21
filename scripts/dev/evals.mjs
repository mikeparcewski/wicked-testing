#!/usr/bin/env node
// On-demand eval runner for wicked-testing agents.
// Reads evals/<agent>/evals.json, dispatches each case via the host CLI's
// Agent tool, captures output, checks assertions, writes a run report.
//
// This script is a harness — it does NOT make Claude API calls directly.
// Instead it prints the dispatch plan; the invoking agent (Claude Code skill)
// executes the actual Agent tool calls. Deterministic assertions are checked
// against captured outputs.
//
// Usage:
//   node scripts/dev/evals.mjs list                 # list eval sets
//   node scripts/dev/evals.mjs plan <agent>         # show cases + cost estimate
//   node scripts/dev/evals.mjs check <agent> <run>  # check assertions on a captured run
//   node scripts/dev/evals.mjs run <agent>          # print plan + run instructions
//   node scripts/dev/evals.mjs check-all            # structural validation of all evals.json
//
// Assertion kinds: produces-artifact, manifest-valid, verdict-in,
// contains-text, not-contains-text, matches-regex, exit-code-zero,
// ledger-matches-manifest, dispatches-agent. See evals/README.md.

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(__dirname, "..", "..");
const EVALS_DIR = join(REPO, "evals");
const WORKSPACE = join(REPO, ".claude", "skills", "wicked-testing-evals", "workspace");

const [cmd = "list", ...rest] = process.argv.slice(2);

function listAgents() {
  if (!existsSync(EVALS_DIR)) { console.log("No evals/ directory."); return; }
  const entries = readdirSync(EVALS_DIR)
    .filter(d => { try { return statSync(join(EVALS_DIR, d)).isDirectory(); } catch { return false; } });
  if (entries.length === 0) { console.log("No eval sets found under evals/."); return; }
  console.log(`Eval sets under ${relative(REPO, EVALS_DIR)}:\n`);
  for (const d of entries) {
    const evalsJson = join(EVALS_DIR, d, "evals.json");
    if (!existsSync(evalsJson)) { console.log(`  ${d}  (missing evals.json)`); continue; }
    try {
      const data = JSON.parse(readFileSync(evalsJson, "utf8"));
      console.log(`  ${d}  ${(data.cases || []).length} cases — ${data.description || ""}`);
    } catch {
      console.log(`  ${d}  (malformed evals.json)`);
    }
  }
}

function planAgent(agent) {
  if (!agent) { console.error("Usage: evals.mjs plan <agent>"); process.exit(1); }
  const file = join(EVALS_DIR, agent, "evals.json");
  if (!existsSync(file)) { console.error(`No eval set for agent: ${agent}`); process.exit(1); }
  const data = JSON.parse(readFileSync(file, "utf8"));
  console.log(`Eval plan — ${data.agent} (${data.subagent_type})`);
  console.log(`Description: ${data.description || "(none)"}\n`);
  for (const c of data.cases) {
    console.log(`  [${c.id}] ${c.prompt.slice(0, 80)}${c.prompt.length > 80 ? "…" : ""}`);
    console.log(`       expected: ${c.expected_shape || "(none)"}`);
    console.log(`       assertions: ${c.assertions.length}`);
    if (c.notes) console.log(`       notes: ${c.notes}`);
    console.log();
  }
  console.log(`Total cases: ${data.cases.length}`);
  console.log(`Estimated cost: $${(data.cases.length * 0.10).toFixed(2)} – $${(data.cases.length * 0.30).toFixed(2)} (rough)`);
  console.log(`\nTo execute: the invoking skill dispatches each case via the Agent tool.`);
  console.log(`Capture output into ${relative(REPO, WORKSPACE)}/iteration-<N>/${agent}/case-<id>/`);
  console.log(`Then check with: node scripts/dev/evals.mjs check ${agent} iteration-<N>`);
}

function globMatch(pattern, files) {
  // Translate glob → regex:
  //   **/ → optional path prefix (zero or more dirs)
  //   **  → any chars across slashes
  //   *   → any chars except /
  let re = pattern.replace(/[.+^$()|[\]]/g, "\\$&");
  re = re.replace(/\*\*\//g, "__DSS__");   // **/ placeholder
  re = re.replace(/\*\*/g, ".*");          // ** → .*
  re = re.replace(/\*/g, "[^/]*");         // * → [^/]*
  re = re.replace(/__DSS__/g, "(?:.+/)?"); // **/ → optional path
  const regex = new RegExp("^" + re + "$");
  return files.filter(f => regex.test(f));
}

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    try {
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else out.push(full);
    } catch {}
  }
  return out;
}

// Shared regex parser — honors an inline `(?flags)` prefix the way the old
// matches-regex branch did, so contains_regex (produces-artifact) and
// matches-regex stay consistent. Returns a compiled RegExp or throws.
function compileRegex(pattern, explicitFlags = "") {
  let src = pattern;
  let flags = explicitFlags;
  const inline = src.match(/^\(\?([a-z]+)\)/);
  if (inline) {
    flags = (flags + inline[1]).split("").filter((v, i, s) => s.indexOf(v) === i).join("");
    src = src.slice(inline[0].length);
  }
  return new RegExp(src, flags);
}

function checkAssertion(a, ctx) {
  switch (a.kind) {
    case "produces-artifact": {
      const matched = globMatch(join(ctx.caseDir, a.path), walk(ctx.caseDir));
      if (matched.length === 0) {
        return { pass: false, detail: "no matching file" };
      }
      // Optional strictness — guards against the "any empty file passes"
      // false-positive the original assertion had. Cases can opt in via
      // `min_bytes` or `contains_regex` without breaking existing cases.
      if (typeof a.min_bytes === "number") {
        const small = matched.filter(f => {
          try { return statSync(f).size < a.min_bytes; } catch { return true; }
        });
        if (small.length > 0) {
          return { pass: false, detail: `${small.length} file(s) below ${a.min_bytes}-byte minimum` };
        }
      }
      if (a.contains_regex) {
        let re;
        try { re = compileRegex(a.contains_regex, a.contains_flags || ""); }
        catch (e) { return { pass: false, detail: `invalid contains_regex: ${e.message}` }; }
        const missing = matched.filter(f => {
          try { return !re.test(readFileSync(f, "utf8")); } catch { return true; }
        });
        if (missing.length > 0) {
          return { pass: false, detail: `${missing.length}/${matched.length} file(s) missing /${a.contains_regex}/` };
        }
      }
      return { pass: true, detail: `matched ${matched.length} file(s)` };
    }
    case "manifest-valid": {
      const manifests = walk(ctx.caseDir).filter(f => f.endsWith("manifest.json"));
      if (manifests.length === 0) return { pass: false, detail: "no manifest.json found" };
      try {
        const m = JSON.parse(readFileSync(manifests[0], "utf8"));
        const required = ["manifest_version", "run_id", "status", "verdict", "artifacts"];
        const missing = required.filter(k => !(k in m));
        return { pass: missing.length === 0, detail: missing.length ? `missing: ${missing.join(",")}` : "valid" };
      } catch (e) {
        return { pass: false, detail: `parse error: ${e.message}` };
      }
    }
    case "verdict-in": {
      const manifests = walk(ctx.caseDir).filter(f => f.endsWith("manifest.json"));
      if (manifests.length === 0) {
        const out = existsSync(ctx.outputFile) ? readFileSync(ctx.outputFile, "utf8") : "";
        const found = a.values.find(v => out.includes(v));
        return { pass: !!found, detail: found ? `found: ${found}` : "no verdict token in output" };
      }
      try {
        const m = JSON.parse(readFileSync(manifests[0], "utf8"));
        // Schema-strict form: verdict is an object with .value
        // Tolerant form: verdict is the string itself
        const v = typeof m?.verdict === "string" ? m.verdict : m?.verdict?.value;
        return { pass: a.values.includes(v), detail: `verdict: ${v ?? "(none)"}` };
      } catch (e) { return { pass: false, detail: e.message }; }
    }
    case "contains-text": {
      const out = existsSync(ctx.outputFile) ? readFileSync(ctx.outputFile, "utf8") : "";
      const needle = a.text;
      // Default to case-insensitive; opt in to exact match with case_sensitive: true
      const found = a.case_sensitive
        ? out.includes(needle)
        : out.toLowerCase().includes(needle.toLowerCase());
      return { pass: found, detail: found ? "found" : `missing: "${needle}"` };
    }
    case "matches-regex": {
      const out = existsSync(ctx.outputFile) ? readFileSync(ctx.outputFile, "utf8") : "";
      let re;
      try { re = compileRegex(a.pattern, a.flags || ""); }
      catch (e) { return { pass: false, detail: `invalid regex: ${e.message}` }; }
      const match = re.test(out);
      return { pass: match, detail: match ? "matched" : `no match for ${re}` };
    }
    case "exit-code-zero": {
      return { pass: ctx.exitCode === 0, detail: `exit=${ctx.exitCode ?? "n/a"}` };
    }
    case "not-contains-text": {
      // Negative form of contains-text. Critical for self-grading-refusal
      // cases — we need to assert the executor did NOT emit "PASS"/"FAIL"
      // tokens, not just that it emitted something that happens to include
      // the word "reviewer". See audit #42 + #75.
      const out = existsSync(ctx.outputFile) ? readFileSync(ctx.outputFile, "utf8") : "";
      const values = Array.isArray(a.values) ? a.values : (a.value != null ? [a.value] : []);
      if (values.length === 0) return { pass: false, detail: "not-contains-text needs `values` array or `value`" };
      // Lowercase the haystack once, not once per value. Coerce every
      // needle to a string up front so a caller passing an integer ("42")
      // doesn't crash on `.includes()`.
      const haystack = a.case_sensitive ? out : out.toLowerCase();
      const needles = values.map(v => a.case_sensitive ? String(v) : String(v).toLowerCase());
      const leaked = needles.filter(n => haystack.includes(n));
      return { pass: leaked.length === 0, detail: leaked.length ? `leaked: ${leaked.map(s => JSON.stringify(s)).join(", ")}` : "clean" };
    }
    case "ledger-matches-manifest": {
      // Dual-write consistency check: the manifest written to the evidence
      // dir must agree with the SQLite ledger on run_id, verdict, status,
      // and evidence_path. Catches the class of bug where the manifest
      // says PASS but the `verdicts` row says FAIL (or vice versa), which
      // is invisible to every other assertion kind. See audit #40 + #42.
      const manifests = walk(ctx.caseDir).filter(f => f.endsWith("manifest.json"));
      if (manifests.length === 0) return { pass: false, detail: "no manifest.json" };
      let manifest;
      try { manifest = JSON.parse(readFileSync(manifests[0], "utf8")); }
      catch (e) { return { pass: false, detail: `manifest parse: ${e.message}` }; }
      const dbPath = a.db_path
        ? resolve(ctx.caseDir, a.db_path)
        : join(ctx.caseDir, ".wicked-testing", "wicked-testing.db");
      if (!existsSync(dbPath)) return { pass: false, detail: `no sqlite ledger at ${relative(ctx.caseDir, dbPath)}` };
      try {
        // Use sqlite3 CLI via node's child_process — avoids an import cycle
        // into better-sqlite3 from a pure-JS runner, and tolerates a JSON-only
        // DomainStore. execFileSync is imported at the top of this file.
        const escId = (manifest.run_id || "").replace(/[^0-9a-f-]/gi, "");
        if (!escId) return { pass: false, detail: "manifest has no run_id" };
        const sql = `SELECT status, evidence_path FROM runs WHERE id = '${escId}';`;
        const rows = execFileSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8" });
        const parsed = JSON.parse(rows || "[]");
        if (parsed.length === 0) return { pass: false, detail: `no runs row for ${escId}` };
        const ledgerStatus = parsed[0].status;
        const ledgerPath = parsed[0].evidence_path;
        if (ledgerStatus !== manifest.status) {
          return { pass: false, detail: `status drift: ledger=${ledgerStatus} manifest=${manifest.status}` };
        }
        // Verdict agreement — look up in verdicts table
        const vRows = JSON.parse(execFileSync("sqlite3", [
          "-json", dbPath, `SELECT verdict FROM verdicts WHERE run_id = '${escId}' ORDER BY created_at DESC LIMIT 1;`
        ], { encoding: "utf8" }) || "[]");
        if (vRows.length === 0) return { pass: false, detail: `no verdicts row for ${escId}` };
        const mVerdict = typeof manifest.verdict === "string" ? manifest.verdict : manifest.verdict?.value;
        if (vRows[0].verdict !== mVerdict) {
          return { pass: false, detail: `verdict drift: ledger=${vRows[0].verdict} manifest=${mVerdict}` };
        }
        return { pass: true, detail: `agree: status=${ledgerStatus} verdict=${mVerdict} path=${ledgerPath}` };
      } catch (e) {
        return { pass: false, detail: `ledger check failed: ${e.message}` };
      }
    }
    case "dispatches-agent": {
      // Skill-level assertion: the captured trace shows a Task() dispatch
      // to the named subagent_type. The trace lives at
      // `${caseDir}/dispatch.trace` — a plain text file the host CLI's
      // eval dispatcher writes alongside output.md. Skill evals need this
      // because the artifact they produce is "the right subagent was
      // invoked" more than "the right file landed on disk". See audit #65.
      const tracePath = join(ctx.caseDir, a.trace_file || "dispatch.trace");
      if (!existsSync(tracePath)) {
        return { pass: false, detail: `no dispatch trace at ${relative(ctx.caseDir, tracePath)}` };
      }
      const trace = readFileSync(tracePath, "utf8");
      const target = a.value || a.subagent_type;
      if (!target) return { pass: false, detail: "dispatches-agent needs `value` or `subagent_type`" };
      const found = trace.includes(target);
      return { pass: found, detail: found ? `found ${target}` : `${target} not in trace` };
    }
    default:
      return { pass: false, detail: `unknown assertion kind: ${a.kind}` };
  }
}

// Structural validation of every evals.json — used by check-all so a PR that
// adds a malformed case file fails CI instead of shipping.
const KNOWN_ASSERTION_KINDS = new Set([
  "produces-artifact",
  "manifest-valid",
  "verdict-in",
  "contains-text",
  "not-contains-text",
  "matches-regex",
  "exit-code-zero",
  "ledger-matches-manifest",
  "dispatches-agent",
]);

function validateEvalSet(agentDir) {
  const file = join(EVALS_DIR, agentDir, "evals.json");
  if (!existsSync(file)) return [{ agent: agentDir, severity: "error", message: "missing evals.json" }];
  let data;
  try { data = JSON.parse(readFileSync(file, "utf8")); }
  catch (e) { return [{ agent: agentDir, severity: "error", message: `parse error: ${e.message}` }]; }

  const problems = [];
  if (!Array.isArray(data.cases)) {
    problems.push({ agent: agentDir, severity: "error", message: "evals.json missing `cases` array" });
    return problems;
  }
  const seenIds = new Set();
  for (const c of data.cases) {
    if (c.id == null) {
      problems.push({ agent: agentDir, severity: "error", message: "case missing `id`" });
      continue;
    }
    if (seenIds.has(c.id)) {
      problems.push({ agent: agentDir, severity: "error", message: `duplicate case id: ${c.id}` });
    }
    seenIds.add(c.id);
    if (!Array.isArray(c.assertions)) {
      problems.push({ agent: agentDir, severity: "error", message: `case ${c.id}: missing assertions array` });
      continue;
    }
    for (const a of c.assertions) {
      if (!a.kind) {
        problems.push({ agent: agentDir, severity: "error", message: `case ${c.id}: assertion missing kind` });
      } else if (!KNOWN_ASSERTION_KINDS.has(a.kind)) {
        problems.push({ agent: agentDir, severity: "error", message: `case ${c.id}: unknown assertion kind '${a.kind}'` });
      }
    }
  }
  return problems;
}

function checkAll() {
  if (!existsSync(EVALS_DIR)) { console.log("No evals/ directory."); return; }
  const entries = readdirSync(EVALS_DIR)
    .filter(d => { try { return statSync(join(EVALS_DIR, d)).isDirectory(); } catch { return false; } });
  const allProblems = [];
  let scanned = 0;
  for (const d of entries) {
    const problems = validateEvalSet(d);
    scanned++;
    for (const p of problems) allProblems.push(p);
  }
  if (allProblems.length === 0) {
    console.log(`evals:check-all — ${scanned} eval set(s), all structurally valid.`);
    process.exit(0);
  }
  console.error(`evals:check-all — ${allProblems.length} problem(s) across ${scanned} eval set(s):`);
  for (const p of allProblems) {
    console.error(`  ${p.severity.toUpperCase()} ${p.agent}: ${p.message}`);
  }
  process.exit(1);
}

function runAgent(agent) {
  // `run` is plan + runtime instructions in one. The actual dispatch still
  // happens in the host CLI's Agent tool — this runner cannot drive the
  // Claude API directly (see header comment). What we CAN do is show the
  // caller exactly where to write outputs and how to invoke the checker.
  if (!agent) { console.error("Usage: evals.mjs run <agent>"); process.exit(1); }
  const file = join(EVALS_DIR, agent, "evals.json");
  if (!existsSync(file)) { console.error(`No eval set for agent: ${agent}`); process.exit(1); }
  const data = JSON.parse(readFileSync(file, "utf8"));
  planAgent(agent);
  console.log(`\n--- runtime ---`);
  console.log(`Model pin: ${data.model_pin || "(none — results will drift with host model)"}`);
  console.log(`Temperature pin: ${data.temperature != null ? data.temperature : "(none)"}`);
  console.log(`Seed pin: ${data.seed != null ? data.seed : "(none)"}`);
  console.log();
  console.log(`For each case, dispatch Task(subagent_type="${data.subagent_type}", ...)`);
  console.log(`Write output to: ${relative(REPO, WORKSPACE)}/iteration-<N>/${agent}/case-<id>/output.md`);
  console.log(`Then verify: node scripts/dev/evals.mjs check ${agent} iteration-<N>`);
}

function checkRun(agent, iteration) {
  if (!agent || !iteration) { console.error("Usage: evals.mjs check <agent> <iteration>"); process.exit(1); }
  const file = join(EVALS_DIR, agent, "evals.json");
  const data = JSON.parse(readFileSync(file, "utf8"));
  const iterDir = join(WORKSPACE, iteration, agent);
  if (!existsSync(iterDir)) { console.error(`No run at: ${iterDir}`); process.exit(1); }

  const report = { agent, iteration, cases: [] };
  let passed = 0, failed = 0, skipped = 0;

  for (const c of data.cases) {
    const caseDir = join(iterDir, `case-${c.id}`);
    const outputFile = join(caseDir, "output.md");
    if (!existsSync(outputFile)) {
      report.cases.push({ id: c.id, status: "not-run", reason: "output.md not captured" });
      skipped++;
      console.log(`  [${c.id}] SKIP (not dispatched — no output.md)`);
      continue;
    }
    const ctx = { caseDir, outputFile, exitCode: existsSync(join(caseDir, "exit.code")) ? +readFileSync(join(caseDir, "exit.code"), "utf8") : null };
    const results = c.assertions.map(a => ({ kind: a.kind, ...checkAssertion(a, ctx) }));
    const casePassed = results.every(r => r.pass);
    report.cases.push({ id: c.id, status: casePassed ? "pass" : "fail", results });
    if (casePassed) passed++; else failed++;
    console.log(`  [${c.id}] ${casePassed ? "PASS" : "FAIL"}`);
    for (const r of results) {
      console.log(`        ${r.pass ? "✓" : "✗"} ${r.kind}${r.detail ? ` — ${r.detail}` : ""}`);
    }
  }

  mkdirSync(iterDir, { recursive: true });
  const reportPath = join(iterDir, "report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  const hash = createHash("sha256").update(JSON.stringify(report)).digest("hex").slice(0, 8);

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped (not dispatched)`);
  console.log(`Report: ${relative(REPO, reportPath)} (sha:${hash})`);
  process.exit(failed > 0 ? 1 : 0);
}

switch (cmd) {
  case "list":      listAgents();            break;
  case "plan":      planAgent(rest[0]);      break;
  case "run":       runAgent(rest[0]);       break;
  case "check":     checkRun(rest[0], rest[1]); break;
  case "check-all": checkAll();              break;
  default:
    console.log(`Usage:
  evals.mjs list                            list every eval set
  evals.mjs plan <agent>                    plan a run for <agent>
  evals.mjs run <agent>                     plan + runtime pin info
  evals.mjs check <agent> <iteration>       verify assertions for a captured run
  evals.mjs check-all                       structural validation of every evals.json (CI-safe)`);
    process.exit(1);
}
