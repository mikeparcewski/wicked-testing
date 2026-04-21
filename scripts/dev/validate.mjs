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

// --- cross-platform shell portability gate ---------------------------------
// Scans fenced bash blocks in agents/, skills/, commands/, scenarios/, and
// top-level scenario/format docs for Unix-only shell constructs that violate
// the global CLAUDE.md portability rule (must work on macOS/Linux AND Windows
// Git Bash / PowerShell). Each finding lands as `warn` so `npm test` doesn't
// regress while the audit lands — flip to `err` once the tree is clean
// across all audit branches.
function checkCrossPlatform() {
  const scanPaths = [
    { dir: join(REPO, "agents"),        glob: /\.md$/ },
    { dir: join(REPO, "agents", "specialists"), glob: /\.md$/ },
    { dir: join(REPO, "commands"),      glob: /\.md$/ },
    { dir: join(REPO, "skills"),        glob: /SKILL\.md$/, recursive: true },
    { dir: join(REPO, "scenarios"),     glob: /\.md$/, recursive: true },
  ];
  const topLevelFiles = ["SCENARIO-FORMAT.md"];

  const files = [];
  for (const { dir, glob, recursive } of scanPaths) {
    if (!existsSync(dir)) continue;
    walkMarkdown(dir, glob, !!recursive, files);
  }
  for (const f of topLevelFiles) {
    const p = join(REPO, f);
    if (existsSync(p)) files.push(p);
  }

  // Patterns that indicate a Unix-only construct. Each matcher runs against
  // the *shell-block text only* (we skip prose so mentions inside backticks
  // or documentation don't fire false positives). Each matcher returns an
  // array of { line, message } tuples.
  const shellMatchers = [
    {
      name: "printf-newline-literal",
      // printf 'foo\n' — zsh vs bash expand \n differently. Use '%s\n' or Python.
      test: (line) => /\bprintf\s+['"][^'"%]*\\n/.test(line),
      message: "printf with literal \\n but no %s — zsh/bash differ. Use `printf '%s\\n' ...` or a Python one-liner.",
    },
    {
      name: "echo-e",
      test: (line) => /\becho\s+-e\b/.test(line),
      message: "`echo -e` is not portable (bash built-in behavior varies). Use `printf '%s\\n' ...` or Python.",
    },
    {
      name: "bare-tmp",
      // /tmp/... that is NOT inside a ${TMPDIR:-...} fallback on the same line.
      test: (line) => {
        if (!/\s\/tmp\//.test(line) && !/^"?\/tmp\//.test(line)) return false;
        if (/\$\{TMPDIR:-/.test(line)) return false;       // guarded
        if (/\$\{TEMP:-/.test(line))   return false;       // guarded
        if (/^#/.test(line.trimStart())) return false;     // comment
        return true;
      },
      message: "Bare `/tmp/...` path — use `${TMPDIR:-${TEMP:-/tmp}}` (Windows uses TEMP, not TMPDIR).",
    },
    {
      name: "unguarded-stderr-null",
      // 2>/dev/null that is NOT followed by `||` within ~20 chars on the same
      // line. Multi-line chains are OK because the Python fallback lives on
      // the next line, so we also pass if the line ends with `\` (continuation).
      test: (line) => {
        const m = line.match(/2>\/dev\/null(.*)$/);
        if (!m) return false;
        const tail = m[1];
        if (/^\s*\\\s*$/.test(tail)) return false;         // line continuation
        if (/\|\|/.test(tail))        return false;        // guarded with ||
        if (/\|\s*\w/.test(tail))     return false;        // piped into next cmd (not a bare swallow)
        return true;
      },
      message: "`2>/dev/null` not followed by `||` fallback on same line — add `|| true` / `|| python -c ...` or drop the redirect.",
    },
    {
      name: "bare-timeout",
      // `timeout` as the first word of a command, not inside a `command -v`
      // guard. GNU timeout is absent from stock macOS and Windows Git Bash.
      test: (line) => {
        const trimmed = line.trimStart();
        if (!/^timeout\s+\S/.test(trimmed)) return false;
        // already wrapped in an if-guard elsewhere; the detector only fires
        // on a raw pipeline start.
        return true;
      },
      message: "Bare `timeout ...` pipeline — not present on stock macOS / Windows Git Bash. Chain `if command -v timeout ... elif gtimeout ... else bare`, or use `lib/exec-with-timeout.mjs`.",
    },
    {
      name: "sed-i-no-backup",
      // `sed -i` with no backup suffix — GNU vs BSD syntax differs.
      test: (line) => /\bsed\s+-i\s+(?!['"][^'"]*['"]\s)/.test(line) && !/sed\s+-i\s+\.\w+/.test(line) && !/sed\s+-i\s+''/.test(line),
      message: "`sed -i` without a backup suffix — GNU and BSD syntax differ. Use `sed -i.bak ...` and delete the backup, or a Python/Node rewrite.",
    },
    {
      name: "realpath-or-readlink-f",
      test: (line) => /\brealpath\b/.test(line) || /\breadlink\s+-f\b/.test(line),
      message: "`realpath` / `readlink -f` are GNU coreutils only. Use a Python/Node one-liner (`python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))'`).",
    },
    {
      name: "find-dash-name",
      // `find . -name ...` — portable `find` differs across BSD/GNU and is
      // absent from Windows Git Bash's lean tool set. Prefer pathlib.rglob.
      test: (line) => /\bfind\s+\.\s+-name\s+/.test(line) || /\bfind\s+\.\s+-type\s/.test(line),
      message: "`find . -name` — flag set differs across BSD/GNU and is sparse on Windows. Use `python3 -c 'import pathlib; ...'` instead.",
    },
    {
      name: "ls-pipe-wc",
      test: (line) => /\bls\s.*\|\s*wc\b/.test(line),
      message: "`ls ... | wc -l` — Windows Git Bash lacks `wc`. Use `python3 -c 'import pathlib; print(len(list(...)))'`.",
    },
  ];

  for (const file of files) {
    const rel = relative(REPO, file);
    const content = readFileSync(file, "utf8");
    // Walk fenced bash/sh/shell blocks only
    // Allow trailing whitespace after the language identifier — CommonMark
    // permits it and most editors emit it when auto-formatting.
    const fenceRe = /```(bash|sh|shell|zsh)[ \t]*\r?\n([\s\S]*?)\r?\n```/g;
    let m;
    while ((m = fenceRe.exec(content)) !== null) {
      const block = m[2];
      const blockStart = content.slice(0, m.index).split(/\r?\n/).length + 1;
      const blockLines = block.split(/\r?\n/);

      // Track whether we're currently inside an `if command -v timeout` / gtimeout
      // guard. The bare-timeout matcher is suppressed until the matching `fi`.
      let timeoutGuardDepth = 0;
      for (let i = 0; i < blockLines.length; i++) {
        const line = blockLines[i];
        if (!line.trim() || line.trim().startsWith("#")) continue;
        if (/^\s*if\s+command\s+-v\s+(timeout|gtimeout)\b/.test(line)) timeoutGuardDepth++;
        if (timeoutGuardDepth > 0 && /^\s*fi\b/.test(line)) timeoutGuardDepth--;

        for (const matcher of shellMatchers) {
          if (matcher.name === "bare-timeout" && timeoutGuardDepth > 0) continue;
          try {
            if (matcher.test(line)) {
              warn("cross-platform", rel, `line ~${blockStart + i}: ${matcher.message}`);
            }
          } catch {
            // Defensive: never let a bad regex break the whole validator.
          }
        }
      }
    }
  }
}

function walkMarkdown(dir, globRe, recursive, out) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git" || name === "workspace") continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (recursive) walkMarkdown(full, globRe, recursive, out);
    } else if (globRe.test(name)) {
      out.push(full);
    }
  }
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
checkCrossPlatform();

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
