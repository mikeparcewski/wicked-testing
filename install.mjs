#!/usr/bin/env node
// wicked-testing CLI — install, update, uninstall, status, version, doctor.
// Cross-platform: macOS/Linux primary, Windows best-effort via python3||python fallback.

import {
  existsSync, mkdirSync, mkdtempSync, cpSync, readdirSync, rmSync,
  readFileSync, writeFileSync, accessSync, statSync, constants as FS_CONST,
} from "node:fs";
import { join, resolve, basename } from "node:path";
import { homedir, tmpdir } from "node:os";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const home = homedir();

const PKG = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8"));
const VERSION = PKG.version;
const INSTALLED_MARKER = ".wicked-testing-version";

// Bare-name skill directories from the pre-0.3 install layout. Older
// installs dropped skills under ~/.claude/skills/{acceptance-testing,
// browser-automation, scenario-authoring, test-oracle, test-runner,
// test-strategy}/ — unprefixed. The 0.3 layout uses wicked-testing-<name>/
// so those unprefixed dirs are now orphans (Claude Code only surfaces
// skills from registered plugins, and generic names like "test-runner"
// could collide with other tools). We migrate them away on install if
// their SKILL.md still carries the wicked-testing signature.
const LEGACY_BARE_SKILL_DIRS = [
  "acceptance-testing",
  "browser-automation",
  "scenario-authoring",
  "test-oracle",
  "test-runner",
  "test-strategy",
];

// Per-CLI target spec. `identityMarkers` is any of-list of filenames/dirs
// that must exist inside the CLI's home-relative root before we'll install
// — prevents us writing into an unrelated `~/.claude/` that a different
// tool created. `isolationTier` tracks whether the host hard-enforces the
// `allowed-tools` frontmatter on agents (Claude Code) or leaves it advisory
// (everyone else); we surface that at install time so users of non-Claude
// hosts know the reviewer isolation is backed by prompt discipline, not
// tool-restriction.
//
// Copilot was formerly targeted at `~/.github/skills` — wrong and dangerous
// (collides with common GitHub dotfiles, and `gh copilot` does not read
// that path). Removed until a real integration point exists; tracked in
// #59.
const CLI_TARGETS = [
  {
    name: "claude",
    rootDir: join(home, ".claude"),
    dir: join(home, ".claude", "skills"),
    agentDir: join(home, ".claude", "agents"),
    commandDir: join(home, ".claude", "commands"),
    platform: "claude",
    identityMarkers: ["settings.json", "plugins", "projects"],
    isolationTier: "hard", // allowed-tools is host-enforced
  },
  {
    name: "gemini",
    rootDir: join(home, ".gemini"),
    dir: join(home, ".gemini", "skills"),
    agentDir: join(home, ".gemini", "agents"),
    commandDir: join(home, ".gemini", "commands"),
    platform: "gemini",
    identityMarkers: ["config.json", "auth", "settings.json"],
    isolationTier: "advisory",
  },
  {
    name: "codex",
    rootDir: join(home, ".codex"),
    dir: join(home, ".codex", "skills"),
    agentDir: join(home, ".codex", "agents"),
    commandDir: join(home, ".codex", "commands"),
    platform: "codex",
    // Codex stores config in TOML and maintains a plugins/ directory; check
    // for either plus its auth blob.
    identityMarkers: ["config.toml", "config.json", "auth.json", "plugins"],
    isolationTier: "advisory",
  },
  {
    name: "cursor",
    rootDir: join(home, ".cursor"),
    dir: join(home, ".cursor", "skills"),
    agentDir: join(home, ".cursor", "agents"),
    commandDir: join(home, ".cursor", "commands"),
    platform: "cursor",
    identityMarkers: ["User", "extensions", "settings.json"],
    isolationTier: "advisory",
  },
  {
    name: "kiro",
    rootDir: join(home, ".kiro"),
    dir: join(home, ".kiro", "skills"),
    agentDir: join(home, ".kiro", "agents"),
    commandDir: join(home, ".kiro", "commands"),
    platform: "kiro",
    identityMarkers: ["config.json", "settings.json"],
    isolationTier: "advisory",
  },
];

// A directory that exists but has none of the identity markers is treated
// as "not really this CLI" — we skip it. Override with --assume-cli=<name>
// if a power user knows their setup stores markers elsewhere.
function hasIdentityMarker(target) {
  if (!existsSync(target.rootDir)) return false;
  for (const m of target.identityMarkers || []) {
    if (existsSync(join(target.rootDir, m))) return true;
  }
  return false;
}

// --- arg parsing -----------------------------------------------------------

const args = argv.slice(2);

// Flag-aliased subcommands: --version / -v / --help / -h must route to the
// matching subcommand, not be stripped as unknown flags and silently fall
// through to the default `install` subcommand.
const FLAG_SUBCOMMANDS = {
  "--version": "version",
  "-v":        "version",
  "--help":    "help",
  "-h":        "help",
};
const first = args[0];
const subcommand = FLAG_SUBCOMMANDS[first]
  ?? (first && !first.startsWith("-") ? first : "install");

const flags = args.filter(a => a.startsWith("--"));
const flagValue = (name) => {
  const f = flags.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!f) return null;
  return f.includes("=") ? f.split("=")[1] : true;
};

const force         = !!flagValue("force");
const skipSelfTest  = !!flagValue("skip-self-test");
const jsonOut       = !!flagValue("json");
const cliArg        = flagValue("cli");
const pathArg       = flagValue("path");
const requireSpec   = flagValue("require");
const assumeCli     = flagValue("assume-cli");  // override identity-marker check

function resolveTargets() {
  if (pathArg && typeof pathArg === "string") {
    const customPath = resolve(pathArg.replace(/^~/, home));
    const dirName = basename(customPath).replace(/^\./, "");
    const known = CLI_TARGETS.find(t => t.name === dirName);
    return [{
      name: dirName,
      rootDir: customPath,
      dir: join(customPath, "skills"),
      agentDir: join(customPath, "agents"),
      commandDir: join(customPath, "commands"),
      platform: known?.platform ?? dirName,
      identityMarkers: known?.identityMarkers ?? [],
      isolationTier: known?.isolationTier ?? "advisory",
    }];
  }
  // Identity-marker detection: presence of `~/.claude/` alone is not enough
  // to conclude Claude Code is installed (the dir might belong to a legacy
  // tool or another plugin). We require at least one of the per-CLI markers
  // declared in CLI_TARGETS — `settings.json`, `plugins/`, etc. Override
  // with --assume-cli=<name> to force-detect when the host's marker set
  // diverges from our list.
  const forceDetect = (assumeCli && typeof assumeCli === "string")
    ? new Set(assumeCli.split(","))
    : new Set();
  const detected = CLI_TARGETS.filter(t =>
    forceDetect.has(t.name) || hasIdentityMarker(t)
  );
  if (cliArg && typeof cliArg === "string") {
    const filter = cliArg.split(",");
    return detected.filter(t => filter.includes(t.name));
  }
  return detected;
}

// --- helpers ---------------------------------------------------------------

function installedVersion(target) {
  const marker = join(target.dir, INSTALLED_MARKER);
  if (!existsSync(marker)) return null;
  try { return readFileSync(marker, "utf8").trim(); } catch { return null; }
}

function writeMarker(target) {
  mkdirSync(target.dir, { recursive: true });
  writeFileSync(join(target.dir, INSTALLED_MARKER), VERSION);
}

function readdirSafe(p) { try { return readdirSync(p); } catch { return []; } }

function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true, force: true });
}

// Migrate a single legacy bare-name skill dir. Returns true if removed.
// Signature check: the dir must contain a SKILL.md whose frontmatter `name:`
// matches the dir name AND whose body mentions "wicked-testing" — otherwise
// it might belong to an unrelated tool and we leave it alone. Paranoid by
// design because generic names like "test-runner" could reasonably be
// owned by another plugin.
function migrateOneLegacyDir(skillsDir, bareName) {
  const path = join(skillsDir, bareName);
  if (!existsSync(path)) return false;
  const skillFile = join(path, "SKILL.md");
  if (!existsSync(skillFile)) return false; // unknown dir shape — leave it
  let body;
  try { body = readFileSync(skillFile, "utf8"); } catch { return false; }
  const nameMatch = body.match(/^name:\s*([A-Za-z0-9_:-]+)/m);
  const frontmatterName = nameMatch ? nameMatch[1] : "";
  // Signature: the SKILL.md's name field matches the dir AND body references
  // wicked-testing. Two independent signals so we don't false-positive on
  // a third-party plugin that happens to use the same dir name.
  const isWickedTesting = frontmatterName === bareName && /wicked-testing/i.test(body);
  if (!isWickedTesting) return false;
  try {
    rmSync(path, { recursive: true, force: true });
    return true;
  } catch { return false; }
}

function migrateLegacyLayout(targets) {
  let total = 0;
  const removed = [];
  for (const t of targets) {
    for (const bare of LEGACY_BARE_SKILL_DIRS) {
      if (migrateOneLegacyDir(t.dir, bare)) {
        removed.push(`${t.name}/${bare}`);
        total++;
      }
    }
  }
  if (total > 0 && !jsonOut) {
    console.log(`[migration] removed ${total} legacy bare-name skill dir(s) from the pre-0.3 layout:`);
    for (const r of removed) console.log(`            ${r}`);
  }
  return removed;
}

// Claude Code uses a plugin-registration system distinct from the file-copy
// install. Skills dropped into ~/.claude/skills/ without a plugin record are
// visible on disk but NOT loaded by the skill resolver — see the release
// notes for 0.3.1 / audit follow-up. We detect whether wicked-testing is
// registered via Claude Code's plugin CLI and print a one-time guidance
// block if not. Silent when the `claude` binary isn't on PATH (other CLIs
// don't need this).
function maybeEmitClaudeCodeGuidance(installedClaudeTarget) {
  if (!installedClaudeTarget) return;
  // `claude` binary present?
  const probe = spawnSyncSafe("claude", ["--version"]);
  if (!probe.ok) return;
  // Is wicked-testing already registered with Claude Code?
  const listing = spawnSyncSafe("claude", ["plugins", "list"]);
  if (listing.ok && /(^|\s)wicked-testing(\s|$|@)/.test(listing.stdout || "")) return;
  if (jsonOut) return; // structured consumers don't want prose guidance
  console.log("");
  console.log("\x1b[33mClaude Code note:\x1b[0m the file-copy install above drops skills into");
  console.log("~/.claude/skills/ but Claude Code only loads skills from registered plugins.");
  console.log("For full integration, also register the plugin:");
  console.log("");
  console.log("  \x1b[36mclaude plugins marketplace add mikeparcewski/wicked-testing\x1b[0m");
  console.log("  \x1b[36mclaude plugins install wicked-testing\x1b[0m");
  console.log("");
  console.log("Other CLIs (Gemini / Codex / Cursor / Kiro) are loaded directly from the");
  console.log("files copied above — no further action needed on those.");
}

// Tiny shell-free wrapper so both probes above stay synchronous and never
// throw on ENOENT. Returns { ok, stdout } — `ok` is false if the binary
// isn't on PATH or the command exited non-zero.
function spawnSyncSafe(cmd, args) {
  try {
    // shell:true so Windows resolves .cmd / .bat shims on PATH (`claude.cmd`,
    // etc.). Args are internal and trusted — no user input reaches this call,
    // so there's no injection surface here.
    const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 3000, shell: true });
    if (r.error || r.status !== 0) return { ok: false, stdout: r.stdout || "" };
    return { ok: true, stdout: r.stdout || "" };
  } catch {
    return { ok: false, stdout: "" };
  }
}

// --- subcommands -----------------------------------------------------------

function cmdVersion() {
  if (jsonOut) {
    console.log(JSON.stringify({ name: PKG.name, version: VERSION }));
  } else {
    // Bare semver — no name prefix. Consumer semver probes expect the
    // same format `node --version` emits (just the version string).
    console.log(VERSION);
  }
}

// Minimal semver-spec evaluator. Supports: exact `1.2.3`, caret `^1.2.3`,
// tilde `~1.2.3`, and comparison operators `>=`, `>`, `<=`, `<`, `=`.
// Pre-release tags (`-alpha.1`) are not supported — all installed versions
// are treated as release builds. Throws on malformed specs.
//
// Caret (`^`) follows the strict SemVer rule for pre-1.0 versions: any
// change in the leftmost non-zero segment is breaking. So `^0.2.0` matches
// `0.2.x` but NOT `0.3.0` (minor bump on a 0.x is breaking); `^0.0.5`
// matches ONLY `0.0.5` (patch bump on 0.0.x is breaking); `^1.2.3` matches
// `1.x.y` with `x.y >= 2.3` (standard semver). This project is currently
// at 0.2.0, so the 0.x behavior matters for consumers using `check`.
function versionSatisfies(installed, spec) {
  const parse = (s) => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(s);
    if (!m) throw new Error(`unsupported version: ${s}`);
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  };
  const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const m = /^(\^|~|>=|>|<=|<|=)?\s*(\d+\.\d+\.\d+)$/.exec(spec.trim());
  if (!m) throw new Error(`unsupported spec: ${spec}`);
  const op = m[1] || "=";
  const iv = parse(installed);
  const sv = parse(m[2]);
  const c = cmp(iv, sv);
  switch (op) {
    case "=":  return c === 0;
    case "^":
      if (sv[0] !== 0) return iv[0] === sv[0] && c >= 0;
      if (sv[1] !== 0) return iv[0] === 0 && iv[1] === sv[1] && iv[2] >= sv[2];
      return iv[0] === 0 && iv[1] === 0 && iv[2] === sv[2];
    case "~":  return iv[0] === sv[0] && iv[1] === sv[1] && iv[2] >= sv[2];
    case ">=": return c >= 0;
    case ">":  return c > 0;
    case "<=": return c <= 0;
    case "<":  return c < 0;
    default:   return false;
  }
}

function cmdCheck() {
  if (!requireSpec || typeof requireSpec !== "string") {
    console.error("usage: wicked-testing check --require <spec>   (e.g. --require=^0.2.0)");
    exit(2);
  }
  let satisfies;
  try { satisfies = versionSatisfies(VERSION, requireSpec); }
  catch (e) {
    if (jsonOut) console.log(JSON.stringify({ current: VERSION, require: requireSpec, error: e.message }));
    else console.error(`wicked-testing check: ${e.message}`);
    exit(2);
  }
  if (jsonOut) {
    console.log(JSON.stringify({ current: VERSION, require: requireSpec, satisfies }));
  } else {
    console.log(satisfies
      ? `${VERSION} satisfies ${requireSpec}`
      : `${VERSION} does NOT satisfy ${requireSpec}`);
  }
  exit(satisfies ? 0 : 1);
}

function cmdHelp() {
  console.log(`wicked-testing ${VERSION}

Usage: wicked-testing <command> [options]

Commands:
  install       Copy skills, agents, and commands into detected AI CLI dirs (default)
  update        Re-install over the existing deployment (idempotent)
  uninstall     Remove all wicked-testing files from detected AI CLI dirs
  status        Show installed version per CLI target
  doctor        Diagnose environment (Node version, detected CLIs, SQLite binding)
  check         Exit 0 if installed version satisfies --require=<spec>, else 1 (non-zero)
  version       Print package version
  help          This message

Options:
  --cli=<list>        Comma-separated CLI names (claude, gemini, codex, cursor, kiro)
  --path=<dir>        Custom target path (e.g. --path=~/.claude)
  --assume-cli=<list> Force-detect a CLI even if its identity markers are missing
  --force             Overwrite even if versions match
  --require=<spec>    Version spec for 'check' (e.g. 0.2.0, ^0.2.0, ~0.2.1, >=0.2.0)
  --skip-self-test    Skip the SQLite bootstrap self-test (install/update only)
  --json              Machine-readable output where supported

Examples:
  npx wicked-testing install
  npx wicked-testing --version
  npx wicked-testing check --require=^0.2.0
  npx wicked-testing status --json
  npx wicked-testing uninstall --cli=claude
  npx wicked-testing doctor
`);
}

function cmdStatus() {
  const targets = resolveTargets();
  const report = targets.map(t => {
    const installed = installedVersion(t);
    return {
      cli: t.name,
      dir: resolve(t.dir, ".."),
      installed_version: installed,
      current_version: VERSION,
      up_to_date: installed === VERSION,
      present: existsSync(t.dir),
    };
  });
  if (jsonOut) {
    console.log(JSON.stringify({ version: VERSION, targets: report }, null, 2));
    return;
  }
  console.log(`wicked-testing ${VERSION} — status\n`);
  if (report.length === 0) {
    console.log("No AI CLI directories detected.");
    return;
  }
  for (const r of report) {
    const tag = r.installed_version === null
      ? "not installed"
      : r.up_to_date ? "up to date" : `installed ${r.installed_version} (stale)`;
    console.log(`  ${r.cli.padEnd(10)} ${tag}`);
  }
}

// Each diagnostic returns { name, status: "ok"|"warn"|"fail", message, fix? }.
// `fail` is red and exits doctor non-zero; `warn` is amber and stays green.
async function cmdDoctor() {
  const checks = [];

  // Node version
  const nodeVer = process.versions.node.split(".").map(Number);
  checks.push(nodeVer[0] >= 18
    ? { name: "node",          status: "ok",   message: process.versions.node }
    : { name: "node",          status: "fail", message: `${process.versions.node} — need >= 18`, fix: "install Node 18+" });

  // AI CLI detection
  const detected = CLI_TARGETS.filter(t => hasIdentityMarker(t));
  checks.push(detected.length > 0
    ? { name: "cli-detection", status: "ok",   message: detected.map(d => `${d.name} (${d.isolationTier})`).join(", ") }
    : { name: "cli-detection", status: "fail", message: "no AI CLIs detected in home directory", fix: "install Claude Code / Gemini / Codex / Cursor / Kiro, or use --path=<dir>" });

  // better-sqlite3 native module
  let sqliteOk = false;
  try { await import("better-sqlite3"); sqliteOk = true; } catch (_) { /* report below */ }
  checks.push(sqliteOk
    ? { name: "better-sqlite3", status: "ok",   message: "loadable" }
    : { name: "better-sqlite3", status: "fail", message: "native module failed to load", fix: "run `npm rebuild better-sqlite3` or reinstall Node 18+ on a supported platform" });

  // Per-target install-marker integrity
  for (const t of detected) {
    const installed = installedVersion(t);
    if (installed === null) {
      checks.push({ name: `install:${t.name}`, status: "warn", message: "not installed yet", fix: `run \`npx wicked-testing install --cli=${t.name}\`` });
    } else if (installed !== VERSION) {
      checks.push({ name: `install:${t.name}`, status: "warn", message: `installed ${installed}, code is ${VERSION}`, fix: `run \`npx wicked-testing update --cli=${t.name}\`` });
    } else {
      // Spot-check: a few expected agent files are present and non-empty.
      const expected = ["wicked-testing-acceptance-test-reviewer.md", "wicked-testing-test-oracle.md"];
      const missing = expected.filter(f => {
        const p = join(t.agentDir, f);
        if (!existsSync(p)) return true;
        try { return statSync(p).size === 0; } catch { return true; }
      });
      checks.push(missing.length === 0
        ? { name: `install:${t.name}`, status: "ok",   message: `${VERSION} integrity verified (${t.isolationTier})` }
        : { name: `install:${t.name}`, status: "fail", message: `missing/empty agent files: ${missing.join(", ")}`, fix: `run \`npx wicked-testing install --force --cli=${t.name}\`` });
    }
  }

  // Schema version vs code (HOW-IT-WORKS.md "DB newer than code")
  const dbPath = join(process.cwd(), ".wicked-testing", "wicked-testing.db");
  if (sqliteOk && existsSync(dbPath)) {
    try {
      const { default: Database } = await import("better-sqlite3");
      const db = new Database(dbPath, { readonly: true });
      const row = db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get();
      db.close();
      const dbVer = row?.version ?? 0;
      const codeVer = 1;
      checks.push(dbVer <= codeVer
        ? { name: "schema",        status: "ok",   message: `DB v${dbVer}, code v${codeVer}` }
        : { name: "schema",        status: "fail", message: `DB v${dbVer} is newer than code v${codeVer}`, fix: "upgrade wicked-testing: `npm install -g wicked-testing@latest`" });
    } catch (err) {
      checks.push({ name: "schema", status: "warn", message: `could not read schema_migrations: ${err.message}`, fix: "run `npx wicked-testing status` to see full project state" });
    }
  }

  // plugin.json drift (delegates to sync-plugin-version --check when present)
  const syncScript = join(__dirname, "scripts", "dev", "sync-plugin-version.mjs");
  if (existsSync(syncScript)) {
    try {
      const { spawnSync } = await import("node:child_process");
      const r = spawnSync(process.execPath, [syncScript, "--check", "--quiet"], { stdio: "pipe" });
      checks.push(r.status === 0
        ? { name: "plugin.json",   status: "ok",   message: "in sync with package.json + disk" }
        : { name: "plugin.json",   status: "warn", message: "drift detected", fix: "run `node scripts/dev/sync-plugin-version.mjs`" });
    } catch (err) {
      checks.push({ name: "plugin.json", status: "warn", message: `drift check errored: ${err.message}` });
    }
  }

  const fails = checks.filter(c => c.status === "fail");
  const warns = checks.filter(c => c.status === "warn");

  if (jsonOut) {
    console.log(JSON.stringify({
      node: process.versions.node,
      detected_clis: detected.map(d => d.name),
      sqlite_ok: sqliteOk,
      checks,
      healthy: fails.length === 0,
      warnings: warns.length,
    }, null, 2));
    if (fails.length > 0) exit(1);
    return;
  }

  const color = (txt, c) => `\x1b[${c}m${txt}\x1b[0m`;
  const badge = (s) => s === "ok" ? color("✓ ok  ", 32) : s === "warn" ? color("! warn", 33) : color("✗ fail", 31);
  console.log(`wicked-testing ${VERSION} — doctor\n`);
  for (const c of checks) {
    console.log(`  ${badge(c.status)}  ${c.name.padEnd(22)} ${c.message}`);
    if (c.fix && c.status !== "ok") console.log(`         ${color("→", 36)} ${c.fix}`);
  }
  console.log();
  if (fails.length > 0) {
    console.log(color(`${fails.length} failure${fails.length === 1 ? "" : "s"}, ${warns.length} warning${warns.length === 1 ? "" : "s"}`, 31));
    exit(1);
  } else if (warns.length > 0) {
    console.log(color(`all critical checks passed (${warns.length} warning${warns.length === 1 ? "" : "s"})`, 33));
  } else {
    console.log(color("all good", 32));
  }
}

async function cmdInstall({ mode }) {
  const targets = resolveTargets();
  if (targets.length === 0) {
    console.error("No AI CLIs detected. Supported: " + CLI_TARGETS.map(t => t.name).join(", "));
    console.error("Use --path=<dir> to target a custom location, or --assume-cli=<name> to override identity-marker detection.");
    exit(1);
  }

  const skillsSrc = join(__dirname, "skills");
  const agentsSrc = join(__dirname, "agents");
  const commandsSrc = join(__dirname, "commands");

  const skillDirs = readdirSafe(skillsSrc).filter(d => !d.startsWith("."));
  const agentFiles = readdirSafe(agentsSrc).filter(f => f.endsWith(".md"));
  const specialistsSrc = join(agentsSrc, "specialists");
  const specialistFiles = readdirSafe(specialistsSrc).filter(f => f.endsWith(".md"));
  const commandFiles = readdirSafe(commandsSrc).filter(f => f.endsWith(".md"));

  let totalSkills = 0, totalAgents = 0, totalCommands = 0;
  const perTargetReport = [];

  // Clean the pre-0.3 layout (bare-name skill dirs) before we write the
  // 0.3+ wicked-testing-<name>/ dirs — otherwise callers end up with a
  // split-brain of stale and fresh skills under the same ~/.claude/skills/.
  // migrateLegacyLayout is paranoid-signature-checked so it won't nuke a
  // same-named dir that belongs to an unrelated plugin.
  const migrated = migrateLegacyLayout(targets);

  for (const target of targets) {
    const existing = installedVersion(target);
    if (existing === VERSION && !force && mode !== "update") {
      console.log(`[${target.name}] already at ${VERSION}, skipping (--force to overwrite)`);
      perTargetReport.push({ target: target.name, status: "skipped", reason: "already-current", isolationTier: target.isolationTier });
      continue;
    }

    // Writable-path pre-flight. If the home-slice is locked (corporate Mac
    // with SIP, Windows profile sealed by policy, NFS-mounted read-only
    // home), fail the target cleanly with an actionable line instead of
    // a raw Node stack that leaves the user wondering which target broke.
    // Other targets in the loop still run.
    try {
      mkdirSync(target.dir, { recursive: true });
      accessSync(target.dir, FS_CONST.W_OK);
    } catch (err) {
      const code = err?.code || "EUNKNOWN";
      console.error(`[${target.name}] SKIPPED — cannot write to ${target.dir}: ${code}`);
      perTargetReport.push({ target: target.name, status: "skipped", reason: code, isolationTier: target.isolationTier });
      continue;
    }

    try {
      for (const skill of skillDirs) copyTree(join(skillsSrc, skill), join(target.dir, `wicked-testing-${skill}`));
      totalSkills += skillDirs.length;

      if (target.agentDir) {
        mkdirSync(target.agentDir, { recursive: true });
        for (const f of agentFiles) cpSync(join(agentsSrc, f), join(target.agentDir, `wicked-testing-${f}`), { force: true });
        for (const f of specialistFiles) cpSync(join(specialistsSrc, f), join(target.agentDir, `wicked-testing-${f}`), { force: true });
        totalAgents += agentFiles.length + specialistFiles.length;
      }

      if (target.commandDir) {
        const cmdDir = join(target.commandDir, "wicked-testing");
        mkdirSync(cmdDir, { recursive: true });
        for (const f of commandFiles) cpSync(join(commandsSrc, f), join(cmdDir, f), { force: true });
        totalCommands += commandFiles.length;
      }

      writeMarker(target);
      console.log(`[${target.name}] installed ${VERSION} (skills=${skillDirs.length} agents=${agentFiles.length}+${specialistFiles.length} commands=${commandFiles.length})`);

      // Surface the isolation tier so users of non-Claude hosts know the
      // reviewer's `allowed-tools: [Read]` is prompt-enforced, not
      // host-enforced. See #73 / docs/INTEGRATION.md.
      if (target.isolationTier === "advisory") {
        console.log(`[${target.name}] note: allowed-tools isolation is ADVISORY on this CLI (prompt-enforced, not host-enforced). For hard isolation use Claude Code.`);
      }

      perTargetReport.push({
        target: target.name,
        status: "installed",
        version: VERSION,
        isolationTier: target.isolationTier,
      });
    } catch (err) {
      const code = err?.code || "EUNKNOWN";
      console.error(`[${target.name}] SKIPPED mid-install — ${code}: ${err?.message ?? err}`);
      perTargetReport.push({ target: target.name, status: "failed", reason: code, isolationTier: target.isolationTier });
    }
  }

  if (!skipSelfTest && mode !== "update") {
    const ok = await selfTest();
    if (!ok) {
      console.error("Self-test failed. Files were copied, but SQLite is not healthy.");
      console.error("Run `npx wicked-testing doctor` for diagnostics.");
      exit(1);
    }
  }

  if (jsonOut) {
    console.log(JSON.stringify({
      version: VERSION,
      targets: perTargetReport,
      skills: totalSkills,
      agents: totalAgents,
      commands: totalCommands,
      legacy_layout_removed: migrated,
    }));
  }

  // Claude-Code-specific guidance: skills dropped into ~/.claude/skills/
  // without a plugin registration aren't loaded by the Claude Code skill
  // resolver. Nudge the user toward `claude plugins marketplace add` +
  // `claude plugins install` when wicked-testing isn't already registered.
  const claudeInstalled = perTargetReport.find(
    r => r.target === "claude" && (r.status === "installed" || r.status === "skipped" && r.reason === "already-current")
  );
  maybeEmitClaudeCodeGuidance(claudeInstalled);

  // Non-zero exit if any target skipped due to a real failure (not just
  // "already installed"). This matches CI expectations — an install script
  // that partially succeeded should be a non-green build.
  if (perTargetReport.some(r => r.status === "failed")) exit(1);
}

function cmdUninstall() {
  const targets = resolveTargets();
  if (targets.length === 0) {
    console.error("No AI CLIs detected.");
    exit(1);
  }
  const agentsSrc = join(__dirname, "agents");
  const skillDirs = readdirSafe(join(__dirname, "skills")).filter(d => !d.startsWith("."));
  const agentFiles = readdirSafe(agentsSrc).filter(f => f.endsWith(".md"));
  const specialistFiles = readdirSafe(join(agentsSrc, "specialists")).filter(f => f.endsWith(".md"));

  for (const target of targets) {
    let removed = 0;
    for (const skill of skillDirs) {
      const p = join(target.dir, `wicked-testing-${skill}`);
      if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); removed++; }
    }
    // Also clean pre-0.3 bare-name skill dirs if they're still ours
    // (signature-checked — see migrateOneLegacyDir).
    for (const bare of LEGACY_BARE_SKILL_DIRS) {
      if (migrateOneLegacyDir(target.dir, bare)) removed++;
    }
    if (target.agentDir) {
      for (const f of agentFiles) {
        const p = join(target.agentDir, `wicked-testing-${f}`);
        if (existsSync(p)) { rmSync(p, { force: true }); removed++; }
      }
      for (const f of specialistFiles) {
        const p = join(target.agentDir, `wicked-testing-${f}`);
        if (existsSync(p)) { rmSync(p, { force: true }); removed++; }
      }
    }
    if (target.commandDir) {
      const cmdDir = join(target.commandDir, "wicked-testing");
      if (existsSync(cmdDir)) { rmSync(cmdDir, { recursive: true, force: true }); removed++; }
    }
    const marker = join(target.dir, INSTALLED_MARKER);
    if (existsSync(marker)) rmSync(marker, { force: true });
    console.log(`[${target.name}] uninstalled — ${removed} item${removed === 1 ? "" : "s"} removed`);
  }
}

// --- self-test (kept from original, trimmed) -------------------------------

async function selfTest() {
  let bootstrapDir = null;
  let store = null;
  try {
    const { DomainStore } = await import("./lib/domain-store.mjs");
    // Isolate the scratch dir under the OS tmp location, NOT cwd(). Running
    // `npx wicked-testing install` from $HOME or any user dir used to clobber
    // any existing `.wicked-testing-bootstrap/` sibling and could leak on
    // Windows if SQLite's WAL handle kept the dir locked past cleanup.
    bootstrapDir = mkdtempSync(join(tmpdir(), "wicked-testing-bootstrap-"));
    store = new DomainStore(bootstrapDir);
    const project = store.create("projects", {
      name: "wicked-testing-bootstrap",
      description: "Bootstrap self-test project",
    });
    const scenario = store.create("scenarios", {
      project_id: project.id,
      name: "bootstrap-self-test",
      format_version: "1.0",
      body: "Bootstrap scenario",
    });
    const now = new Date().toISOString();
    const run = store.create("runs", { project_id: project.id, scenario_id: scenario.id, started_at: now, status: "running" });
    store.update("runs", run.id, { finished_at: new Date().toISOString(), status: "passed" });
    store.create("verdicts", { run_id: run.id, verdict: "PASS", reviewer: "bootstrap", reason: "self-test" });
    return true;
  } catch (e) {
    console.warn("  self-test: " + e.message);
    return false;
  } finally {
    // finally runs whether the self-test passed, threw, or returned early.
    // Close the DB first so Windows WAL handles release before rmSync tries
    // to remove the scratch dir. Both cleanup steps swallow errors: a failed
    // cleanup is a resource leak at worst, not a reason to crash the install.
    if (store) { try { store.close(); } catch {} }
    if (bootstrapDir) { try { rmSync(bootstrapDir, { recursive: true, force: true }); } catch {} }
  }
}

// --- dispatch --------------------------------------------------------------

(async () => {
  switch (subcommand) {
    case "install":   await cmdInstall({ mode: "install" }); break;
    case "update":    await cmdInstall({ mode: "update" });  break;
    case "uninstall": cmdUninstall();                         break;
    case "status":    cmdStatus();                            break;
    case "doctor":    await cmdDoctor();                      break;
    case "check":     cmdCheck();                             break;
    case "version":   cmdVersion();                           break;
    case "help":      cmdHelp();                              break;
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      cmdHelp();
      exit(1);
  }
})();
