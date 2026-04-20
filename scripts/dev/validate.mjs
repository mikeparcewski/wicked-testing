#!/usr/bin/env node
// Repo-local structural validator for wicked-testing.
// Zero LLM cost. Checks frontmatter, reference integrity, namespace rules,
// and evidence schema self-consistency. Invoked by the wicked-testing-validate
// dev skill, or run directly: `node scripts/dev/validate.mjs`.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(__dirname, "..", "..");

const args = process.argv.slice(2);
const jsonOut = args.includes("--json");
const quiet = args.includes("--quiet");

const findings = []; // { severity: 'error'|'warn', area, file, message }

function err(area, file, message)  { findings.push({ severity: "error", area, file, message }); }
function warn(area, file, message) { findings.push({ severity: "warn",  area, file, message }); }

// --- frontmatter parser (no yaml dep) --------------------------------------

function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return null;
  const body = m[1];
  const fm = {};
  const lines = body.split(/\r?\n/);
  let currentKey = null;
  let currentList = null;
  let currentMulti = null;
  let currentMultiIndent = 0;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line) { currentMulti = null; continue; }

    // multiline continuation
    if (currentMulti !== null) {
      const indent = raw.match(/^\s*/)[0].length;
      if (indent >= currentMultiIndent && line.trimStart() !== "") {
        fm[currentMulti] = (fm[currentMulti] ? fm[currentMulti] + "\n" : "") + line.trimStart();
        continue;
      } else {
        currentMulti = null;
      }
    }

    // list item continuation
    const listItem = line.match(/^\s+-\s+(.+)$/);
    if (listItem && currentList) {
      fm[currentList].push(listItem[1]);
      continue;
    } else if (currentList && !listItem) {
      currentList = null;
    }

    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (kv) {
      currentKey = kv[1];
      const val = kv[2];
      if (val === "|" || val === ">-" || val === ">") {
        currentMulti = currentKey;
        currentMultiIndent = (raw.match(/^\s*/)[0].length) + 2;
        fm[currentKey] = "";
      } else if (val === "") {
        currentList = currentKey;
        fm[currentKey] = [];
      } else {
        fm[currentKey] = val;
      }
    }
  }
  return fm;
}

// --- checks ----------------------------------------------------------------

function checkAgents() {
  const dirs = [join(REPO, "agents"), join(REPO, "agents", "specialists")];
  const requiredFields = ["name", "subagent_type", "description", "model", "allowed-tools"];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const entries = readdirSync(dir).filter(f => f.endsWith(".md"));
    for (const f of entries) {
      const path = join(dir, f);
      const rel = relative(REPO, path);
      const content = readFileSync(path, "utf8");
      const fm = parseFrontmatter(content);
      if (!fm) { err("agents", rel, "missing or malformed frontmatter"); continue; }
      for (const k of requiredFields) {
        if (!(k in fm)) err("agents", rel, `missing required frontmatter key: ${k}`);
      }
      if (fm.subagent_type && !fm.subagent_type.startsWith("wicked-testing:")) {
        err("agents", rel, `subagent_type must start with 'wicked-testing:' (got: ${fm.subagent_type})`);
      }
      const expectedName = f.replace(/\.md$/, "");
      if (fm.name && fm.name !== expectedName) {
        warn("agents", rel, `frontmatter name '${fm.name}' doesn't match filename '${expectedName}'`);
      }
    }
  }
}

function checkSkills() {
  const skillsRoot = join(REPO, "skills");
  const requiredFields = ["name", "description"];
  if (!existsSync(skillsRoot)) { err("skills", "skills/", "skills directory missing"); return; }
  const dirs = readdirSync(skillsRoot).filter(d => {
    try { return statSync(join(skillsRoot, d)).isDirectory(); } catch { return false; }
  });
  for (const d of dirs) {
    const skillFile = join(skillsRoot, d, "SKILL.md");
    const rel = relative(REPO, skillFile);
    if (!existsSync(skillFile)) { err("skills", rel, "SKILL.md missing"); continue; }
    const fm = parseFrontmatter(readFileSync(skillFile, "utf8"));
    if (!fm) { err("skills", rel, "malformed frontmatter"); continue; }
    for (const k of requiredFields) {
      if (!(k in fm)) err("skills", rel, `missing required frontmatter key: ${k}`);
    }
  }
}

function checkPluginJson() {
  const path = join(REPO, ".claude-plugin", "plugin.json");
  const rel = relative(REPO, path);
  if (!existsSync(path)) { err("plugin.json", rel, "file missing"); return; }
  let data;
  try { data = JSON.parse(readFileSync(path, "utf8")); }
  catch (e) { err("plugin.json", rel, `parse error: ${e.message}`); return; }

  for (const group of ["skills", "agents", "commands"]) {
    const entries = data[group] || [];
    for (const entry of entries) {
      if (!entry.path) { err("plugin.json", rel, `${group}: entry missing 'path'`); continue; }
      const target = join(REPO, entry.path);
      if (!existsSync(target)) {
        err("plugin.json", rel, `${group}: path does not exist — ${entry.path}`);
      }
    }
  }

  const skillPaths = new Set((data.skills || []).map(s => s.path));
  const skillDirs = existsSync(join(REPO, "skills"))
    ? readdirSync(join(REPO, "skills"))
        .filter(d => {
          try { return statSync(join(REPO, "skills", d)).isDirectory(); } catch { return false; }
        })
        .map(d => `skills/${d}/SKILL.md`)
    : [];
  for (const p of skillDirs) {
    if (!skillPaths.has(p)) warn("plugin.json", rel, `skill present on disk but not registered: ${p}`);
  }
}

function checkEvidenceSchema() {
  const path = join(REPO, "schemas", "evidence.json");
  const rel = relative(REPO, path);
  if (!existsSync(path)) { err("schema", rel, "evidence.json missing"); return; }
  let data;
  try { data = JSON.parse(readFileSync(path, "utf8")); }
  catch (e) { err("schema", rel, `parse error: ${e.message}`); return; }
  if (!data.$schema)  err("schema", rel, "missing $schema");
  if (!data.$id)      err("schema", rel, "missing $id");
  if (!data.required) err("schema", rel, "missing required fields array");
}

function checkNamespaceAlignment() {
  const docPath = join(REPO, "docs", "NAMESPACE.md");
  const rel = relative(REPO, docPath);
  if (!existsSync(docPath)) { err("namespace", rel, "NAMESPACE.md missing"); return; }
  const doc = readFileSync(docPath, "utf8");

  const tier1Dir = join(REPO, "agents");
  if (existsSync(tier1Dir)) {
    for (const f of readdirSync(tier1Dir).filter(x => x.endsWith(".md"))) {
      const agentName = f.replace(/\.md$/, "");
      const token = `wicked-testing:${agentName}`;
      if (!doc.includes(token)) {
        warn("namespace", rel, `Tier-1 agent '${token}' not referenced in NAMESPACE.md`);
      }
    }
  }
}

// --- run -------------------------------------------------------------------

checkAgents();
checkSkills();
checkPluginJson();
checkEvidenceSchema();
checkNamespaceAlignment();

const errors = findings.filter(f => f.severity === "error");
const warns  = findings.filter(f => f.severity === "warn");

if (jsonOut) {
  console.log(JSON.stringify({ errors, warnings: warns, ok: errors.length === 0 }, null, 2));
} else if (!quiet) {
  const color = (txt, c) => `\x1b[${c}m${txt}\x1b[0m`;
  console.log(`wicked-testing validate — ${errors.length} errors, ${warns.length} warnings\n`);
  for (const f of findings) {
    const tag = f.severity === "error" ? color("ERROR", 31) : color("warn ", 33);
    console.log(`  ${tag}  [${f.area}] ${f.file}`);
    console.log(`         ${f.message}`);
  }
  if (errors.length === 0) console.log(color(`\n  ok`, 32));
}

process.exit(errors.length > 0 ? 1 : 0);
