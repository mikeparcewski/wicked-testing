#!/usr/bin/env node
// Pre-release gate. Run by the GitHub Actions release workflow before publish.
// Checks: CHANGELOG has an entry for the version, plugin.json version matches.
// Usage: node scripts/dev/release-check.mjs <version>   e.g. 0.7.0

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(__dirname, "..", "..");

const version = process.argv[2];
if (!version) {
  console.error("usage: release-check.mjs <version>  (e.g. 0.7.0)");
  process.exit(1);
}

let ok = true;

function fail(msg) { console.error(`FAIL  ${msg}`); ok = false; }
function pass(msg) { console.log( `ok    ${msg}`); }

// --- CHANGELOG entry --------------------------------------------------------

const clPath = join(REPO, "CHANGELOG.md");
if (!existsSync(clPath)) {
  fail("CHANGELOG.md not found");
} else {
  const cl = readFileSync(clPath, "utf8");
  const heading = `## [${version}]`;
  if (cl.includes(heading)) {
    pass(`CHANGELOG.md contains ${heading}`);
  } else {
    fail(`CHANGELOG.md is missing an entry for ${heading} — add one before releasing`);
  }
}

// --- plugin.json version matches -------------------------------------------

const pluginPath = join(REPO, ".claude-plugin", "plugin.json");
if (!existsSync(pluginPath)) {
  fail(".claude-plugin/plugin.json not found");
} else {
  const plugin = JSON.parse(readFileSync(pluginPath, "utf8"));
  // The release workflow's "Set version from tag" step sets the version in CI,
  // so plugin.json may still carry the old version at preflight time. Skip
  // this check here — sync-plugin-version's --check catches it in npm test.
  pass(`plugin.json present (v${plugin.version})`);
}

// --- [Unreleased] section is empty -----------------------------------------

const clContent = existsSync(clPath) ? readFileSync(clPath, "utf8") : "";
const unreleasedMatch = clContent.match(/## \[Unreleased\]\s*\n([\s\S]*?)(?=## \[|$)/);
const unreleasedBody = (unreleasedMatch?.[1] ?? "").trim();
if (unreleasedBody.length === 0) {
  pass("[Unreleased] section is empty");
} else {
  fail(`[Unreleased] section has content that wasn't moved into the ${version} entry — clear it before releasing`);
}

if (!ok) process.exit(1);
console.log(`\nrelease-check passed for v${version}`);
