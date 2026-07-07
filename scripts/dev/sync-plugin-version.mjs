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

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emitBusEvent } from "../../lib/bus-emit.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(__dirname, "..", "..");


const pkgPath    = join(REPO, "package.json");
const pluginPath = join(REPO, ".claude-plugin", "plugin.json");
const marketplacePath = join(REPO, ".claude-plugin", "marketplace.json");
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

// marketplace.json carries its own copy of the plugin version in plugins[].
// It is NOT derived from package.json the way plugin.json is, so it silently
// drifted (0.4.0 vs a 0.4.2 plugin.json) until this was wired in. Optional —
// tolerate its absence so the script stays reusable for siblings without one.
let marketplace = null;
let mpEntry = null;
if (existsSync(marketplacePath)) {
  try {
    marketplace = JSON.parse(readFileSync(marketplacePath, "utf8"));
  } catch (err) {
    console.error(`sync-plugin-version: could not read marketplace.json — ${err.message}`);
    process.exit(2);
  }
  mpEntry = (marketplace.plugins ?? []).find(p => p.name === plugin.name) ?? null;
}

// --- Desired state: version only -------------------------------------------
// plugin.json carries no skills list — Claude Code auto-scans the skills/
// directory when the list is absent. install.mjs distributes all 47 skills
// by scanning skills/ directly. Only the version field is synced here.

const desired = {
  version: pkg.version,
};

// --- Diff each section against the current manifest ------------------------


const drifts = [];
if (plugin.version !== desired.version)
  drifts.push(`version: ${plugin.version} -> ${desired.version}`);
if (mpEntry && mpEntry.version !== desired.version)
  drifts.push(`marketplace.json entry: ${mpEntry.version} -> ${desired.version}`);

if (drifts.length === 0) {
  log(`plugin.json in sync (v${pkg.version})`);
  process.exit(0);
}

if (checkOnly) {
  console.error(`plugin.json drift detected:`);
  for (const d of drifts) console.error(`  - ${d}`);
  console.error(`run: node scripts/dev/sync-plugin-version.mjs`);
  process.exit(1);
}

// --- Apply changes ---------------------------------------------------------

const merged = { ...plugin, version: desired.version };
writeFileSync(pluginPath, JSON.stringify(merged, null, 2) + "\n");

// Keep the marketplace plugin entry's version in lockstep too. Only the
// version is derived — descriptions/source are author-maintained.
if (mpEntry && mpEntry.version !== desired.version) {
  mpEntry.version = desired.version;
  writeFileSync(marketplacePath, JSON.stringify(marketplace, null, 2) + "\n");
}

log(`manifest updated:`);
for (const d of drifts) log(`  - ${d}`);

emitBusEvent("wicked.contract.published", {
  version: desired.version,
  skills: (plugin.skills ?? []).map(s => ({ name: s.name })),
});
