#!/usr/bin/env node
// Keeps .claude-plugin/plugin.json#version in lockstep with package.json#version.
// Invoked by the `prepublishOnly` script so npm publish never ships a drifted
// plugin manifest.
//
// Exits 0 on success (including no-op). Exits 1 if the files cannot be read,
// parsed, or written. Use `--check` to fail instead of writing when drift is
// detected (useful in CI to assert the manifest is already in sync).

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(__dirname, "..", "..");

const pkgPath    = join(REPO, "package.json");
const pluginPath = join(REPO, ".claude-plugin", "plugin.json");
const checkOnly  = process.argv.includes("--check");

const pkg    = JSON.parse(readFileSync(pkgPath, "utf8"));
const plugin = JSON.parse(readFileSync(pluginPath, "utf8"));

if (plugin.version === pkg.version) {
  if (!process.argv.includes("--quiet")) {
    console.log(`plugin.json version in sync (${pkg.version})`);
  }
  process.exit(0);
}

if (checkOnly) {
  console.error(`plugin.json version drift: plugin.json=${plugin.version} package.json=${pkg.version}`);
  console.error(`run: node scripts/dev/sync-plugin-version.mjs`);
  process.exit(1);
}

const prev = plugin.version;
plugin.version = pkg.version;
writeFileSync(pluginPath, JSON.stringify(plugin, null, 2) + "\n");
console.log(`plugin.json version ${prev} -> ${pkg.version}`);
