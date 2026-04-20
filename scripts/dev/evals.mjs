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

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

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
  const re = new RegExp("^" + pattern.replace(/[.+^$()|[\]]/g, "\\$&").replace(/\*\*/g, ".__DS__").replace(/\*/g, "[^/]*").replace(/__DS__/g, "*") + "$");
  return files.filter(f => re.test(f));
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

function checkAssertion(a, ctx) {
  switch (a.kind) {
    case "produces-artifact": {
      const matched = globMatch(join(ctx.caseDir, a.path), walk(ctx.caseDir));
      return { pass: matched.length > 0, detail: matched.length ? `matched ${matched.length} file(s)` : "no matching file" };
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
        const v = m?.verdict?.value;
        return { pass: a.values.includes(v), detail: `verdict: ${v}` };
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
      // Translate inline (?i) flag — JS uses the flags argument instead
      let pattern = a.pattern;
      let flags = a.flags || "";
      const inlineFlags = pattern.match(/^\(\?([a-z]+)\)/);
      if (inlineFlags) {
        flags = (flags + inlineFlags[1]).split("").filter((v, i, s) => s.indexOf(v) === i).join("");
        pattern = pattern.slice(inlineFlags[0].length);
      }
      try {
        const re = new RegExp(pattern, flags);
        const match = re.test(out);
        return { pass: match, detail: match ? "matched" : `no match for /${pattern}/${flags}` };
      } catch (e) {
        return { pass: false, detail: `invalid regex: ${e.message}` };
      }
    }
    case "exit-code-zero": {
      return { pass: ctx.exitCode === 0, detail: `exit=${ctx.exitCode ?? "n/a"}` };
    }
    default:
      return { pass: false, detail: `unknown assertion kind: ${a.kind}` };
  }
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
  case "list":  listAgents();          break;
  case "plan":  planAgent(rest[0]);    break;
  case "check": checkRun(rest[0], rest[1]); break;
  default:
    console.log(`Usage:
  evals.mjs list
  evals.mjs plan <agent>
  evals.mjs check <agent> <iteration>`);
    process.exit(1);
}
