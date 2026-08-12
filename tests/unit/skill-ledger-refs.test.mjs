/**
 * tests/unit/skill-ledger-refs.test.mjs
 *
 * Regression guard for the ledger carve (#161): the modules
 * lib/{domain-store,oracle-queries,manifest,bus-emit,migrate}.mjs and
 * lib/migrations/*.sql moved into the published wicked-ledger package, so
 * skill bodies must never direct agents at those old in-repo lib/ paths —
 * the paths no longer exist. Snippets import from the bare "wicked-ledger"
 * specifier instead (same idiom as lib/gate.mjs and scenarios/test-runner.md).
 *
 *   1. No skill markdown references a carved module by its old lib/ path.
 *   2. The wicked-ledger public entry (its root export) actually exposes
 *      every symbol the skill snippets rely on, so the bare-specifier
 *      imports the skills prescribe resolve to real exports.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const SKILLS_ROOT = join(REPO, "skills");

// The five carved modules plus their SQL migrations. Deliberately does NOT
// match testing's own remaining lib/ modules (gate.mjs,
// context-md-validator.mjs, exec-with-timeout.mjs).
const CARVED_REF =
  /\blib\/(?:domain-store|oracle-queries|manifest|bus-emit|migrate)\.mjs\b|\blib\/migrations\//;

function markdownFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFilesUnder(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

test("no skill markdown references carved ledger modules by old lib/ paths", () => {
  const offenders = [];
  for (const file of markdownFilesUnder(SKILLS_ROOT)) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (CARVED_REF.test(line)) {
        offenders.push(`${file.slice(REPO.length + 1)}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `carved ledger modules must be referenced via the "wicked-ledger" package, not old lib/ paths:\n${offenders.join("\n")}`,
  );
});

test("wicked-ledger public entry exports every symbol skill snippets use", async () => {
  const ledger = await import("wicked-ledger");
  const required = [
    "buildManifest",
    "emitBusEvent",
    "DomainStore",
    "createDomainStore",
    "buildOracleQuery",
    "routeQuestion",
    "QUERIES",
    "applyMigrations",
    "SCHEMA_VERSION",
  ];
  for (const name of required) {
    assert.ok(
      name in ledger,
      `wicked-ledger public entry is missing export: ${name}`,
    );
  }
});
