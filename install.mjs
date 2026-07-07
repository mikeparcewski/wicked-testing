#!/usr/bin/env node
// wicked-testing CLI — install, update, uninstall, status, version, doctor.
// Cross-platform: macOS/Linux primary, Windows best-effort via python3||python fallback.

import {
  existsSync, mkdirSync, mkdtempSync, cpSync, readdirSync, rmSync,
  readFileSync, writeFileSync, accessSync, constants as FS_CONST,
} from "node:fs";
import { join, resolve, basename } from "node:path";
import { homedir, tmpdir } from "node:os";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

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
// Copilot: previously targeted at `~/.github/skills` — wrong path (collides
// with gh CLI auth/config dotfiles). Correct personal-skills path is
// ~/.copilot/skills/ per GitHub Copilot docs (added April 2026 agent mode).
// First install requires --assume-cli=copilot since ~/.copilot/ won't exist
// until skills are first written; subsequent installs detect via "skills" dir.
//
// Gemini CLI removed — superseded by Antigravity (Google's next-gen terminal
// coding agent). Antigravity lives under ~/.gemini/antigravity-cli/, a
// subdirectory of the same root, so the two never conflicted at the file
// level — but maintaining a dead target creates confusion.
//
// pi (pi-mono) note: skills are installed to ~/.pi/agent/skills/. pi resolves
// skill paths from ~/.pi/agent/settings.json; if auto-discovery of that dir
// is not enabled by default the user may need to add `"skills": ["skills/"]`
// to their global settings.json. Tracked in #61.
//
// Claude Code is special: its config root is redirectable via
// $CLAUDE_CONFIG_DIR (used for multi-tenant setups, alt-config layouts
// like ~/alt-configs/.claude, and corporate-policy home overrides). The
// single-root claude entry below is only the "default" — resolveClaudeCandidates()
// expands it into 1..N concrete targets at install time. See #87.
const CLI_TARGETS = [
  {
    name: "claude",
    rootDir: join(home, ".claude"),
    dir: join(home, ".claude", "skills"),
    platform: "claude",
    identityMarkers: ["settings.json", "plugins", "projects"],
    isolationTier: "hard", // allowed-tools is host-enforced
  },
  {
    name: "antigravity",
    // Google's terminal coding agent (replaced Gemini CLI, May 2026). Uses a
    // plugin-registry model: each plugin gets its own subdir under plugins/.
    // Skills-only install — agents and commands are Claude Code concepts that
    // don't map cleanly to other CLIs. Agent/command functionality is covered
    // by the agent skills installed into the skills dir.
    // Hooks: single ~/.gemini/antigravity-cli/hooks.json with outer key = hook name.
    rootDir: join(home, ".gemini", "antigravity-cli"),
    dir: join(home, ".gemini", "antigravity-cli", "plugins", "wicked-testing", "skills"),


    hookPath: join(home, ".gemini", "antigravity-cli", "hooks.json"),
    hookMode: "merge",
    platform: "antigravity",
    identityMarkers: ["plugins"],
    isolationTier: "advisory",
  },
  {
    name: "codex",
    // Skills-only: agents and commands are Claude Code-native concepts.
    // Hooks: single ~/.codex/hooks.json, same schema as Claude Code.
    rootDir: join(home, ".codex"),
    dir: join(home, ".codex", "skills"),


    hookPath: join(home, ".codex", "hooks.json"),
    hookMode: "merge",
    platform: "codex",
    identityMarkers: ["config.toml", "config.json", "auth.json", "plugins"],
    isolationTier: "advisory",
  },
  {
    name: "cursor",
    // Skills-only: agents and commands are Claude Code-native concepts.
    // Hooks: single ~/.cursor/hooks.json, version:1 schema, lowercase event names.
    rootDir: join(home, ".cursor"),
    dir: join(home, ".cursor", "skills"),


    hookPath: join(home, ".cursor", "hooks.json"),
    hookMode: "merge",
    platform: "cursor",
    identityMarkers: ["User", "extensions", "settings.json"],
    isolationTier: "advisory",
  },
  {
    name: "kiro",
    // Skills-only: agents and commands are Claude Code-native concepts.
    // Hooks: ~/.kiro/hooks/ directory — drop wicked-testing.json there.
    rootDir: join(home, ".kiro"),
    dir: join(home, ".kiro", "skills"),


    hookPath: join(home, ".kiro", "hooks"),
    hookMode: "dir",
    platform: "kiro",
    identityMarkers: ["config.json", "settings.json"],
    isolationTier: "advisory",
  },
  {
    name: "opencode",
    // SST's open-source terminal coding agent. Global config root is
    // ~/.config/opencode/ with opencode.json as the main config file.
    // Skills-only: opencode supports agents/ and commands/ natively, but the
    // formats diverge (opencode uses tools: {write, edit, bash, ...} booleans;
    // we use Claude Code's allowed-tools string). Agent/command functionality
    // is covered by the agent skills installed into skills/.
    // Hooks: opencode uses TypeScript plugins only — no JSON hook format.
    rootDir: join(home, ".config", "opencode"),
    dir: join(home, ".config", "opencode", "skills"),


    hookPath: null,  // TS plugin system only — not installable via hooks.json
    platform: "opencode",
    identityMarkers: ["opencode.json"],
    isolationTier: "advisory",
  },
  {
    name: "pi",
    // pi-mono coding agent CLI (earendil-works/pi). Global config at
    // ~/.pi/agent/ (settings.json, auth.json confirmed).
    // Skills-only: pi agent extensions are TypeScript-only (no markdown).
    // Hooks: pi uses TypeScript extensions only — no JSON hook format.
    rootDir: join(home, ".pi", "agent"),
    dir: join(home, ".pi", "agent", "skills"),


    hookPath: null,  // TS extension system only — not installable via hooks.json
    platform: "pi",
    identityMarkers: ["settings.json", "auth.json"],
    isolationTier: "advisory",
  },
  {
    name: "copilot",
    // GitHub Copilot agent skills (added April 2026). Personal skills live at
    // ~/.copilot/skills/ (docs: docs.github.com/en/copilot).
    // Skills-only: Copilot agents require .agent.md extension and a different
    // tools schema. Agent/command functionality is covered by agent skills.
    // Hooks: ~/.copilot/hooks/ directory, agentStop event name.
    // First install requires --assume-cli=copilot since ~/.copilot/ doesn't
    // exist until files are first written there.
    rootDir: join(home, ".copilot"),
    dir: join(home, ".copilot", "skills"),


    hookPath: join(home, ".copilot", "hooks"),
    hookMode: "dir",
    platform: "copilot",
    identityMarkers: ["skills"],
    isolationTier: "advisory",
  },
];

// Expand the canonical CLI_TARGETS "claude" entry into one or more concrete
// target objects that reflect the user's actual Claude Code config root.
//
// Precedence:
//   1. $CLAUDE_CONFIG_DIR — authoritative when set. Skip identity-marker
//      checks (trusted) so `CLAUDE_CONFIG_DIR=/new/path npx wicked-testing`
//      works even when the dir is freshly created and empty.
//   2. Otherwise probe ~/.claude plus a small list of alt-config layouts
//      (~/alt-configs/.claude, ~/.config/claude) — each is filtered by the
//      normal identity-marker check downstream.
//
// Added in 0.3.3 after a user discovered their installs were silently
// landing in ~/.claude while their real config lived at ~/alt-configs/.claude.
function buildClaudeTarget(rootDir, source, { trusted = false } = {}) {
  return {
    name: "claude",
    rootDir,
    dir: join(rootDir, "skills"),
    platform: "claude",
    identityMarkers: ["settings.json", "plugins", "projects"],
    isolationTier: "hard",
    source,    // for doctor output ("env:CLAUDE_CONFIG_DIR" / "default" / "alt-configs" / "xdg")
    trusted,   // skip identity-marker check when true
  };
}

// ---------------------------------------------------------------------------
// Hook installation helpers
// ---------------------------------------------------------------------------

// Build the CLI-specific hooks.json content for a given target.
// scriptPath must be the absolute path to claim-nudge.mjs.
// Returns null if the CLI uses a TypeScript extension system (hookPath null).
function buildHookJson(targetName, scriptPath, timeout = 5000) {
  const cmd = `node "${scriptPath}"`;
  switch (targetName) {
    case "cursor":
      // Cursor: version:1, lowercase event names, flat handler array per event.
      return {
        version: 1,
        hooks: { stop: [{ command: cmd, timeout, matcher: "*" }] },
      };
    case "kiro":
      // Kiro: version:1, array of hook objects with trigger + action fields.
      return {
        version: 1,
        hooks: [{
          name: "wicked-testing-claim-nudge",
          trigger: "Stop",
          action: { type: "command", command: cmd },
          timeout,
          enabled: true,
        }],
      };
    case "copilot":
      // Copilot: version:1, Stop event is named "agentStop", no matcher needed.
      return {
        version: 1,
        hooks: { agentStop: [{ type: "command", command: cmd }] },
      };
    case "antigravity":
      // Antigravity: outer key = hook name (not event). Inner key = event name.
      return {
        "wicked-testing-claim-nudge": {
          Stop: [{ matcher: "*", hooks: [{ type: "command", command: cmd, timeout }] }],
        },
      };
    default:
      // Codex and any future Claude Code-compatible CLIs: standard schema.
      return {
        hooks: {
          Stop: [{ matcher: "*", hooks: [{ type: "command", command: cmd, timeout }] }],
        },
      };
  }
}

// Merge our hook config into an existing one, replacing any prior wicked-testing
// hook (identified by command string containing "wicked-testing") so re-install
// is idempotent. Returns the merged object.
function mergeHookJson(existing, ours, targetName) {
  if (!existing) return ours;
  if (targetName === "antigravity") {
    // Outer key = hook name — just overwrite our key, leave others.
    return { ...existing, ...ours };
  }
  if (targetName === "kiro") {
    // Array-based: filter out old wicked-testing entry by name, append ours.
    const kept = (existing.hooks || []).filter(h => h.name !== "wicked-testing-claim-nudge");
    return { ...existing, hooks: [...kept, ...ours.hooks] };
  }
  // Object-based (Cursor, Codex): merge by event key.
  const mergedHooks = { ...(existing.hooks || {}) };
  for (const [event, handlers] of Object.entries(ours.hooks || {})) {
    const kept = (mergedHooks[event] || []).filter(h => !isWickedTestingHookEntry(h));
    mergedHooks[event] = [...kept, ...handlers];
  }
  return { ...existing, hooks: mergedHooks };
}

// Remove wicked-testing entries from an existing hook file.
// Returns the cleaned object (or null if the file is now empty and can be deleted).
function removeHookJson(existing, targetName) {
  if (!existing) return null;
  if (targetName === "antigravity") {
    const cleaned = { ...existing };
    delete cleaned["wicked-testing-claim-nudge"];
    return Object.keys(cleaned).length ? cleaned : null;
  }
  if (targetName === "kiro") {
    const kept = (existing.hooks || []).filter(h => h.name !== "wicked-testing-claim-nudge");
    return { ...existing, hooks: kept };
  }
  const mergedHooks = { ...(existing.hooks || {}) };
  for (const event of Object.keys(mergedHooks)) {
    mergedHooks[event] = (mergedHooks[event] || []).filter(h => !isWickedTestingHookEntry(h));
    if (mergedHooks[event].length === 0) delete mergedHooks[event];
  }
  return { ...existing, hooks: mergedHooks };
}

function isWickedTestingHookEntry(h) {
  if (typeof h.command === "string") return h.command.includes("wicked-testing");
  if (Array.isArray(h.hooks)) return h.hooks.some(inner =>
    typeof inner.command === "string" && inner.command.includes("wicked-testing")
  );
  return false;
}

// Read a JSON file safely; returns null on any error.
function readJsonSafe(filePath) {
  try { return JSON.parse(readFileSync(filePath, "utf8")); } catch { return null; }
}

function resolveClaudeCandidates() {
  const envDir = process.env.CLAUDE_CONFIG_DIR;
  if (envDir && typeof envDir === "string" && envDir.trim()) {
    const root = resolve(envDir.trim().replace(/^~/, home));
    return [buildClaudeTarget(root, "env:CLAUDE_CONFIG_DIR", { trusted: true })];
  }
  return [
    buildClaudeTarget(join(home, ".claude"),                 "default"),
    buildClaudeTarget(join(home, "alt-configs", ".claude"),  "alt-configs"),
    buildClaudeTarget(join(home, ".config", "claude"),       "xdg"),
  ];
}

// Full list of candidate targets with expansion applied. Use this anywhere
// we'd previously iterate CLI_TARGETS directly (resolveTargets, cmdDoctor).
function allCandidateTargets() {
  const out = [];
  for (const spec of CLI_TARGETS) {
    if (spec.name === "claude") out.push(...resolveClaudeCandidates());
    else out.push(spec);
  }
  return out;
}

// A directory that exists but has none of the identity markers is treated
// as "not really this CLI" — we skip it. Override with --assume-cli=<name>
// if a power user knows their setup stores markers elsewhere. Targets
// flagged `trusted` (explicit --path or $CLAUDE_CONFIG_DIR) bypass this.
function hasIdentityMarker(target) {
  if (target.trusted) return true;
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
// Supports both forms:
//   --flag=value   (canonical)
//   --flag value   (common shell muscle-memory; prior versions silently
//                   treated this as bare `--flag` and dropped the value,
//                   which is how 0.3.2-era `install --path ~/alt-configs/.claude`
//                   fell through to default detection. Fixed in 0.3.3.)
const flagValue = (name) => {
  const f = flags.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!f) return null;
  let val;
  if (f.includes("=")) {
    // Take everything after the FIRST `=` so two-char operators in values
    // (e.g. `--require=>=20`, `--require=<=20`) survive. `split("=")[1]`
    // truncated `>=`/`<=` to `>`/`<`, breaking `check --require`.
    val = f.slice(f.indexOf("=") + 1);
  } else {
    const idx = args.indexOf(f);
    const next = args[idx + 1];
    val = (next && !next.startsWith("-")) ? next : true;
  }
  // String boolean coercion: `--force=false` should evaluate to boolean
  // false, not the truthy string "false". Since callers use `!!flagValue()`
  // the truthy-string case was silently flipping intent. Kept narrow: only
  // literal "true" / "false" are coerced; other string values pass through.
  if (val === "false") return false;
  if (val === "true")  return true;
  return val;
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
      platform: known?.platform ?? dirName,
      identityMarkers: known?.identityMarkers ?? [],
      isolationTier: known?.isolationTier ?? "advisory",
      source: "path-arg",
      trusted: true,
    }];
  }
  // Identity-marker detection: presence of `~/.claude/` alone is not enough
  // to conclude Claude Code is installed (the dir might belong to a legacy
  // tool or another plugin). We require at least one of the per-CLI markers
  // declared in CLI_TARGETS — `settings.json`, `plugins/`, etc. Override
  // with --assume-cli=<name> to force-detect when the host's marker set
  // diverges from our list.
  //
  // For claude, allCandidateTargets() expands the canonical spec into the
  // $CLAUDE_CONFIG_DIR target (if set) or ~/.claude + common alt-config
  // paths (~/alt-configs/.claude, ~/.config/claude). Each candidate is
  // filtered individually by the identity-marker check.
  const forceDetect = (assumeCli && typeof assumeCli === "string")
    ? new Set(assumeCli.split(","))
    : new Set();
  const candidates = allCandidateTargets();
  const detected = candidates.filter(t =>
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

function cmdContract() {
  const plugin = JSON.parse(readFileSync(join(__dirname, ".claude-plugin", "plugin.json"), "utf8"));
  const out = {
    version: plugin.version,
    agents: (plugin.agents || []).map(a => ({ subagent_type: `wicked-testing:${a.name}`, tier: a.tier })),
  };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

function cmdHelp() {
  console.log(`wicked-testing ${VERSION}

Usage: wicked-testing <command> [options]

Commands:
  install       Copy skills into detected AI CLI dirs (default)
  update        Re-install over the existing deployment (idempotent)
  uninstall     Remove all wicked-testing files from detected AI CLI dirs
  status        Show installed version per CLI target
  doctor        Diagnose environment (Node version, detected CLIs, SQLite binding)
  check         Exit 0 if installed version satisfies --require=<spec>, else 1 (non-zero)
  contract      Print the published skill contract from plugin.json (JSON)
  version       Print package version
  help          This message

Options:
  --cli=<list>        Comma-separated CLI names (claude, antigravity, codex, copilot, cursor, kiro, opencode, pi)
  --path=<dir>        Custom target path (e.g. --path=~/.claude). Also accepts --path <dir>.
  --assume-cli=<list> Force-detect a CLI even if its identity markers are missing
  --force             Overwrite even if versions match
  --require=<spec>    Version spec for 'check' (e.g. 0.2.0, ^0.2.0, ~0.2.1, >=0.2.0)
  --skip-self-test    Skip the SQLite bootstrap self-test (install/update only)
  --json              Machine-readable output where supported

Environment:
  CLAUDE_CONFIG_DIR   Override Claude Code's config root (authoritative when set).
                      Install will target ONLY this path for the claude CLI. When
                      unset, wicked-testing probes ~/.claude, ~/alt-configs/.claude,
                      and ~/.config/claude, and installs into each that has Claude
                      identity markers (settings.json / plugins/ / projects/).

Examples:
  npx wicked-testing install
  npx wicked-testing --version
  npx wicked-testing check --require=^0.2.0
  npx wicked-testing status --json
  npx wicked-testing uninstall --cli=claude
  npx wicked-testing doctor
  CLAUDE_CONFIG_DIR=~/alt-configs/.claude npx wicked-testing install
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

  // $CLAUDE_CONFIG_DIR awareness — surface what we picked up (or didn't)
  // so users debugging "why didn't my install take" can see whether we
  // honored the env var. Added in 0.3.3 after installs silently hit
  // ~/.claude while the user's real config lived at ~/alt-configs/.claude.
  //
  // Reuse resolveClaudeCandidates() so the marker list and path rules stay
  // canonical — any drift between installer and doctor would be a source
  // of confusing "installer wrote here but doctor says that" bugs.
  const envTarget = resolveClaudeCandidates().find(t => t.source === "env:CLAUDE_CONFIG_DIR");
  if (envTarget) {
    const root = envTarget.rootDir;
    if (!existsSync(root)) {
      checks.push({ name: "CLAUDE_CONFIG_DIR", status: "warn", message: `set to ${root} but the directory does not exist`, fix: "create the directory or unset CLAUDE_CONFIG_DIR" });
    } else {
      // Identity markers are trusted-skipped at install time so empty
      // freshly-created dirs work. In doctor we want to actually verify
      // them so we catch the "env var points at the wrong place" case.
      const markers = envTarget.identityMarkers || [];
      const hasMarkers = markers.some(m => existsSync(join(root, m)));
      checks.push(hasMarkers
        ? { name: "CLAUDE_CONFIG_DIR", status: "ok",   message: root }
        : { name: "CLAUDE_CONFIG_DIR", status: "warn", message: `${root} exists but has no Claude identity markers (${markers.join(" / ")})`, fix: "verify Claude Code is actually configured at this path" });
    }
  }

  // AI CLI detection — use allCandidateTargets() so alt-config Claude
  // layouts show up here instead of being invisible to doctor.
  const detected = allCandidateTargets().filter(t => hasIdentityMarker(t));
  checks.push(detected.length > 0
    ? { name: "cli-detection", status: "ok",   message: detected.map(d => {
        const suffix = d.source && d.source !== "default" ? ` @ ${d.rootDir} [${d.source}]` : "";
        return `${d.name}${suffix} (${d.isolationTier})`;
      }).join(", ") }
    : { name: "cli-detection", status: "fail", message: "no AI CLIs detected in home directory", fix: "install Claude Code / Antigravity / Codex / Copilot / Cursor / Kiro / opencode / pi, or use --path=<dir>" });

  // better-sqlite3 native module
  let sqliteOk = false;
  try {
    await import("better-sqlite3");
    sqliteOk = true;
    checks.push({ name: "better-sqlite3", status: "ok", message: "ok" });
  } catch (err) {
    const abi = /NODE_MODULE_VERSION|compiled against a different Node|ERR_DLOPEN_FAILED/i.test(String(err && err.message));
    checks.push(abi
      ? { name: "better-sqlite3", status: "warn", message: "ABI mismatch — run `npm rebuild better-sqlite3`", fix: "run `npm rebuild better-sqlite3`" }
      : { name: "better-sqlite3", status: "warn", message: "not loadable (" + String(err && err.message).split("\n")[0] + ")", fix: "run `npm rebuild better-sqlite3` or reinstall Node 18+ on a supported platform" });
  }

  // Per-target install-marker integrity. Disambiguate by source when the
  // same CLI name has multiple roots (e.g., two claude targets at
  // ~/.claude and ~/alt-configs/.claude).
  const claudeTargetCount = detected.filter(t => t.name === "claude").length;
  for (const t of detected) {
    const suffix = (t.name === "claude" && claudeTargetCount > 1 && t.source)
      ? `[${t.source}]` : "";
    const checkName = `install:${t.name}${suffix}`;
    const installed = installedVersion(t);
    if (installed === null) {
      checks.push({ name: checkName, status: "warn", message: `not installed yet at ${t.rootDir}`, fix: `run \`npx wicked-testing install --cli=${t.name}\`` });
    } else if (installed !== VERSION) {
      checks.push({ name: checkName, status: "warn", message: `installed ${installed} at ${t.rootDir}, code is ${VERSION}`, fix: `run \`npx wicked-testing update --cli=${t.name}\`` });
    } else {
      checks.push({ name: checkName, status: "ok", message: `${VERSION} installed (${t.isolationTier})` });
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
      claude_config_dir: process.env.CLAUDE_CONFIG_DIR ?? null,
      // Preserve the 0.3.2 shape (string[]) for back-compat. Rich info
      // (rootDir, source) is under detected_targets.
      detected_clis: detected.map(d => d.name),
      detected_targets: detected.map(d => ({ name: d.name, root: d.rootDir, source: d.source ?? "default" })),
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
  const skillDirs = readdirSafe(skillsSrc).filter(d => !d.startsWith("."));

  let totalSkills = 0;
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

      // Install hooks (opt-in claim-nudge). Claude Code uses the plugin's
      // hooks/hooks.json (auto-registered by the plugin system — no action
      // needed here). Other CLIs get a per-CLI hook config written to
      // hookPath. opencode and pi use TypeScript extensions — hookPath null.
      if (target.hookPath) {
        const scriptPath = join(__dirname, "hooks", "claim-nudge.mjs");
        const hookJson = buildHookJson(target.name, scriptPath);
        try {
          if (target.hookMode === "dir") {
            mkdirSync(target.hookPath, { recursive: true });
            writeFileSync(join(target.hookPath, "wicked-testing.json"), JSON.stringify(hookJson, null, 2));
          } else {
            // Merge into single hooks file; create if missing.
            const existing = readJsonSafe(target.hookPath);
            const merged = mergeHookJson(existing, hookJson, target.name);
            writeFileSync(target.hookPath, JSON.stringify(merged, null, 2));
          }
          console.log(`[${target.name}] hooks installed (claim-nudge opt-in)`);
        } catch (err) {
          console.warn(`[${target.name}] hooks skipped — could not write to ${target.hookPath}: ${err?.code || err?.message}`);
        }
      }

      writeMarker(target);
      console.log(`[${target.name}] installed ${VERSION} — ${skillDirs.length} skills`);

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
      legacy_layout_removed: migrated,
    }));
  }

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
  const skillDirs = readdirSafe(join(__dirname, "skills")).filter(d => !d.startsWith("."));

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
    if (target.hookPath) {
      try {
        if (target.hookMode === "dir") {
          const p = join(target.hookPath, "wicked-testing.json");
          if (existsSync(p)) { rmSync(p, { force: true }); removed++; }
        } else {
          const existing = readJsonSafe(target.hookPath);
          if (existing) {
            const cleaned = removeHookJson(existing, target.name);
            if (cleaned && Object.keys(cleaned.hooks || cleaned).length > 0) {
              writeFileSync(target.hookPath, JSON.stringify(cleaned, null, 2));
            } else {
              rmSync(target.hookPath, { force: true });
            }
            removed++;
          }
        }
      } catch { /* leave hook file if we can't modify it */ }
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
    case "contract":  cmdContract();                           break;
    case "version":   cmdVersion();                           break;
    case "help":      cmdHelp();                              break;
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      cmdHelp();
      exit(1);
  }
})();
