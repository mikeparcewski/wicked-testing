#!/usr/bin/env node
// Keeps .claude-plugin/plugin.json in lockstep with package.json AND with
// the actual skills/agents/commands on disk. Invoked by `prepublishOnly` so
// npm publish never ships a drifted plugin manifest; `--check` mode is
// called by `npm test` to catch drift at PR time before it reaches a
// release.
//
// Kept under the historical name `sync-plugin-version.mjs` to avoid
// breaking the package.json script references; scope expanded from
// version-only (Wave 1) to the full manifest in Wave 5 (#67).
//
// Exit codes:
//   0 — manifest is in sync (or was successfully synced when not --check)
//   1 — drift detected and --check was passed, or write failed
//   2 — inputs could not be read / parsed

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(__dirname, "..", "..");

const pkgPath    = join(REPO, "package.json");
const pluginPath = join(REPO, ".claude-plugin", "plugin.json");
const argv = process.argv.slice(2);
const checkOnly = argv.includes("--check");
const quiet     = argv.includes("--quiet");

function log(...parts) { if (!quiet) console.log(...parts); }

let pkg, plugin;
try {
  pkg    = JSON.parse(readFileSync(pkgPath, "utf8"));
  plugin = JSON.parse(readFileSync(pluginPath, "utf8"));
} catch (err) {
  console.error(`sync-plugin-version: could not read inputs — ${err.message}`);
  process.exit(2);
}

// --- Derive the canonical manifest shape from disk -------------------------

function listSkills() {
  const dir = join(REPO, "skills");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(d => {
      try { return statSync(join(dir, d)).isDirectory() && existsSync(join(dir, d, "SKILL.md")); }
      catch { return false; }
    })
    .sort()
    .map(d => ({
      name:    `wicked-testing:${d}`,
      path:    `skills/${d}/SKILL.md`,
      command: `/wicked-testing:${d}`,
    }));
}

function listAgents() {
  const dir = join(REPO, "agents");
  if (!existsSync(dir)) return [];
  const direct = readdirSync(dir)
    .filter(f => f.endsWith(".md"))
    .sort()
    .map(f => ({ name: f.replace(/\.md$/, ""), path: `agents/${f}` }));
  const specDir = join(dir, "specialists");
  const specialists = existsSync(specDir)
    ? readdirSync(specDir)
        .filter(f => f.endsWith(".md"))
        .sort()
        .map(f => ({ name: f.replace(/\.md$/, ""), path: `agents/specialists/${f}` }))
    : [];
  return [...direct, ...specialists];
}

function listCommands() {
  const dir = join(REPO, "commands");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith(".md"))
    .sort()
    .map(f => {
      const name = f.replace(/\.md$/, "");
      return { name, path: `commands/${f}`, slash: `/wicked-testing:${name}` };
    });
}

const desired = {
  version:     pkg.version,
  skills:      listSkills(),
  agents:      listAgents(),
  commands:    listCommands(),
};

// --- Diff each section against the current manifest ------------------------

function jsonEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const drifts = [];
if (plugin.version !== desired.version)       drifts.push(`version: ${plugin.version} -> ${desired.version}`);
if (!jsonEqual(plugin.skills,   desired.skills))   drifts.push(`skills (${plugin.skills?.length ?? 0} -> ${desired.skills.length})`);
if (!jsonEqual(plugin.agents,   desired.agents))   drifts.push(`agents (${plugin.agents?.length ?? 0} -> ${desired.agents.length})`);
if (!jsonEqual(plugin.commands, desired.commands)) drifts.push(`commands (${plugin.commands?.length ?? 0} -> ${desired.commands.length})`);

if (drifts.length === 0) {
  log(`plugin.json in sync (v${pkg.version}, ${desired.skills.length} skills, ${desired.agents.length} agents, ${desired.commands.length} commands)`);
  process.exit(0);
}

if (checkOnly) {
  console.error(`plugin.json drift detected:`);
  for (const d of drifts) console.error(`  - ${d}`);
  console.error(`run: node scripts/dev/sync-plugin-version.mjs`);
  process.exit(1);
}

// --- Apply changes ---------------------------------------------------------

const merged = { ...plugin, ...desired };
writeFileSync(pluginPath, JSON.stringify(merged, null, 2) + "\n");
log(`plugin.json updated:`);
for (const d of drifts) log(`  - ${d}`);
