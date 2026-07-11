#!/usr/bin/env node
// Keeps .claude-plugin/plugin.json in lockstep with package.json AND with
// the actual skills on disk (the distribution is skills-only — former
// agents and commands are skills now). Invoked by `prepublishOnly` so
// npm publish never ships a drifted plugin manifest; `--check` mode is
// called by `npm test` to catch drift at PR time before it reaches a
// release.
//
// Kept under the historical name `sync-plugin-version.mjs` to avoid
// breaking the package.json script references; scope expanded from
// version-only (Wave 1) to the full manifest in Wave 5 (#67), narrowed to
// skills-only in the agents/commands -> skills conversion.
//
// Exit codes:
//   0 — manifest is in sync (or was successfully synced when not --check)
//   1 — drift detected and --check was passed, or write failed
//   2 — inputs could not be read / parsed

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emitBusEvent } from "../../lib/bus-emit.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(__dirname, "..", "..");

function tierOf(absPath) {
  try {
    const c = readFileSync(absPath, "utf8");
    const fm = c.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const m = fm && fm[1].match(/^tier:\s*([12])\s*$/m);
    return m ? Number(m[1]) : null;
  } catch { return null; }
}

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

// --- Derive the canonical manifest shape from disk -------------------------

// Every skill dir becomes one manifest entry. Tiered worker skills (the
// former agents, tier 1/2 in SKILL.md frontmatter, `context: fork`) carry
// their tier into the manifest — that tier is what `wicked-testing contract`
// and the wicked.contract.published emit are derived from. Orchestrator
// skills (plan, execution, setup, ...) have no tier and no contract entry.
function listSkills() {
  const dir = join(REPO, "skills");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(d => {
      try { return statSync(join(dir, d)).isDirectory() && existsSync(join(dir, d, "SKILL.md")); }
      catch { return false; }
    })
    .sort()
    .map(d => {
      const tier = tierOf(join(dir, d, "SKILL.md"));
      return {
        name:    `wicked-testing:${d}`,
        path:    `skills/${d}/SKILL.md`,
        command: `/wicked-testing:${d}`,
        ...(tier !== null ? { tier } : {}),
      };
    });
}

const desired = {
  version:     pkg.version,
  skills:      listSkills(),
};

// --- Diff each section against the current manifest ------------------------

function jsonEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const drifts = [];
if (plugin.version !== desired.version)       drifts.push(`version: ${plugin.version} -> ${desired.version}`);
if (!jsonEqual(plugin.skills,   desired.skills))   drifts.push(`skills (${plugin.skills?.length ?? 0} -> ${desired.skills.length})`);
// Legacy manifest sections — the distribution is skills-only, so any
// surviving `agents`/`commands` array is drift to be deleted.
if ("agents"   in plugin) drifts.push(`legacy agents array present (${plugin.agents?.length ?? 0} entries) -> removed`);
if ("commands" in plugin) drifts.push(`legacy commands array present (${plugin.commands?.length ?? 0} entries) -> removed`);
if (mpEntry && mpEntry.version !== desired.version)
  drifts.push(`marketplace.json entry: ${mpEntry.version} -> ${desired.version}`);

if (drifts.length === 0) {
  log(`plugin.json in sync (v${pkg.version}, ${desired.skills.length} skills)`);
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
// Skills-only distribution: drop the legacy sections outright.
delete merged.agents;
delete merged.commands;
writeFileSync(pluginPath, JSON.stringify(merged, null, 2) + "\n");

// Keep the marketplace plugin entry's version in lockstep too. Only the
// version is derived — descriptions/source are author-maintained.
if (mpEntry && mpEntry.version !== desired.version) {
  mpEntry.version = desired.version;
  writeFileSync(marketplacePath, JSON.stringify(marketplace, null, 2) + "\n");
}

log(`manifest updated:`);
for (const d of drifts) log(`  - ${d}`);

// Wire shape is intentionally unchanged (key `agents`, field `subagent_type`)
// so consumers like wicked-garden's wg-check keep parsing it: the tiered
// skills' colon-style names are byte-identical to the old subagent_type ids —
// they now resolve to forked-skill dispatch instead of Task() agents.
emitBusEvent("wicked.contract.published", {
  version: desired.version,
  agents: desired.skills
    .filter(s => s.tier === 1 || s.tier === 2)
    .map(s => ({ subagent_type: s.name, tier: s.tier })),
});
