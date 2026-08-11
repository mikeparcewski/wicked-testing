/**
 * tests/unit/migrate.test.mjs
 *
 * Trust-module test for the versioned SQL migration runner (lib/migrate.mjs)
 * and migration 002 (verdict CHECK constraint + verdicts.equivalence_json).
 *
 * The load-bearing claim under test: migration 002 must apply cleanly on a
 * PRE-EXISTING v1 database (the upgrade path real users hit), not just on a
 * fresh one. 002 redefines the `verdicts` table (SQLite can't ALTER TABLE ADD
 * CONSTRAINT), so this proves the 12-step rebuild preserves existing rows,
 * recreates the indexes, lands the new column, and enforces the CHECK — all
 * with `foreign_keys = ON` (the runtime pragma DomainStore sets).
 *
 * Uses an in-memory better-sqlite3 db and reads the SQL files directly so the
 * test is independent of DomainStore wiring. If better-sqlite3 can't load in
 * this environment the whole file skips (matches the oracle-query test stance).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";

import { applyMigrations, listMigrations } from "wicked-ledger";

const require = createRequire(import.meta.url);
// The migration SQL now ships inside the wicked-ledger package. Read it from
// the installed package (located via its exported package.json) rather than a
// local lib/migrations copy, which no longer exists in wicked-testing.
const MIG_DIR = join(dirname(require.resolve("wicked-ledger/package.json")), "lib", "migrations");

let Database;
try {
  Database = require("better-sqlite3");
} catch {
  // SQLite unavailable in this environment — skip the whole file rather than
  // fail. The migration logic is pure SQL; CI environments with the driver
  // exercise it.
  console.error("[migrate.test] better-sqlite3 unavailable — skipping migration tests");
}

const ISO = "2026-01-01T00:00:00.000Z";

// Seed a v1-era project/scenario/run chain plus a single PASS verdict — the
// only state a pre-002 ledger could legally hold.
function seedV1Row(db) {
  db.prepare("INSERT INTO projects (id,name,created_at,updated_at,deleted) VALUES (?,?,?,?,0)").run("p1", "proj", ISO, ISO);
  db.prepare("INSERT INTO scenarios (id,project_id,name,format_version,created_at,updated_at,deleted) VALUES (?,?,?,?,?,?,0)").run("s1", "p1", "sc", "1.0", ISO, ISO);
  db.prepare("INSERT INTO runs (id,project_id,scenario_id,started_at,status,created_at,updated_at,deleted) VALUES (?,?,?,?,?,?,?,0)").run("r1", "p1", "s1", ISO, "passed", ISO, ISO);
  db.prepare("INSERT INTO verdicts (id,run_id,verdict,reviewer,created_at,updated_at,deleted) VALUES (?,?,?,?,?,?,0)").run("v1", "r1", "PASS", "rev", ISO, ISO);
}

test("listMigrations discovers 001 + 002 + 003 in numeric order", { skip: !Database }, () => {
  const list = listMigrations(MIG_DIR);
  const versions = list.map((m) => m.version);
  assert.ok(versions.includes(1), "001 must be discoverable");
  assert.ok(versions.includes(2), "002 must be discoverable");
  assert.ok(versions.includes(3), "003 must be discoverable (wicked-vault absorption)");
  // Sorted ascending by version.
  assert.deepEqual(versions, [...versions].sort((a, b) => a - b));
});

test("applyMigrations on a FRESH db brings schema to v3 and creates equivalence_json + vault_payload_sha", { skip: !Database }, () => {
  const db = new Database(":memory:");
  try {
    db.pragma("foreign_keys = ON");
    const results = applyMigrations(db, MIG_DIR);
    // All three migrations applied (none pre-existing on a fresh db).
    assert.deepEqual(results.map((r) => r.status), ["applied", "applied", "applied"]);
    const ver = db.prepare("SELECT MAX(version) v FROM schema_migrations").get().v;
    assert.equal(ver, 3, "fresh db should land at schema version 3");
    // The equivalence_json column exists on verdicts (from 002).
    const cols = db.prepare("PRAGMA table_info(verdicts)").all().map((c) => c.name);
    assert.ok(cols.includes("equivalence_json"), "verdicts.equivalence_json must exist after 002");
    // The vault_payload_sha column exists on verdicts (from 003, wicked-vault absorption).
    assert.ok(cols.includes("vault_payload_sha"), "verdicts.vault_payload_sha must exist after 003");
  } finally {
    db.close();
  }
});

test("002 + 003 apply cleanly on a PRE-EXISTING v1 db (the upgrade path) and preserve rows", { skip: !Database }, () => {
  const db = new Database(":memory:");
  try {
    db.pragma("foreign_keys = ON");

    // --- Build a v1 db: apply ONLY 001, mark version 1 applied (mirrors a
    // ledger created before 002 shipped). ---
    db.exec(readFileSync(join(MIG_DIR, "001_initial.sql"), "utf8"));
    assert.equal(db.prepare("SELECT MAX(version) v FROM schema_migrations").get().v, 1);
    seedV1Row(db);

    // --- Now run the runner: it must see v1 applied, SKIP 001, and APPLY 002 + 003. ---
    const results = applyMigrations(db, MIG_DIR);
    const byVersion = Object.fromEntries(results.map((r) => [r.version, r.status]));
    assert.equal(byVersion[1], "already_applied", "001 must be skipped on a v1 db (no re-exec)");
    assert.equal(byVersion[2], "applied", "002 must be applied to upgrade v1 → v2");
    assert.equal(byVersion[3], "applied", "003 must be applied to add vault_payload_sha (wicked-vault absorption)");
    assert.equal(db.prepare("SELECT MAX(version) v FROM schema_migrations").get().v, 3);

    // --- The pre-existing row survives verbatim; new columns are NULL on it. ---
    const row = db.prepare("SELECT * FROM verdicts WHERE id = ?").get("v1");
    assert.equal(row.verdict, "PASS");
    assert.equal(row.reviewer, "rev");
    assert.equal(row.equivalence_json, null, "legacy row's equivalence_json defaults to NULL");
    assert.equal(row.vault_payload_sha, null, "legacy row's vault_payload_sha defaults to NULL");

    // --- Indexes that lived on the old table were recreated (002 + 003 indexes). ---
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'verdicts' AND name LIKE 'idx_%'")
      .all()
      .map((r) => r.name)
      .sort();
    assert.ok(idx.includes("idx_verdicts_created_at"), "idx_verdicts_created_at must exist");
    assert.ok(idx.includes("idx_verdicts_run"), "idx_verdicts_run must exist");
    assert.ok(idx.includes("idx_verdicts_verdict"), "idx_verdicts_verdict must exist");
    assert.ok(idx.includes("idx_verdicts_vault_sha"), "idx_verdicts_vault_sha must exist (from 003)");

    // --- The DROP/RENAME left no orphaned FKs (verdicts.run_id → runs.id). ---
    const fk = db.pragma("foreign_key_check", { simple: false });
    assert.ok(Array.isArray(fk) && fk.length === 0, "no FK violations after the table redefinition");
  } finally {
    db.close();
  }
});

test("002 CHECK constraint accepts the full enum (incl. CONDITIONAL) and rejects out-of-enum", { skip: !Database }, () => {
  const db = new Database(":memory:");
  try {
    db.pragma("foreign_keys = ON");
    applyMigrations(db, MIG_DIR);
    seedV1Row(db); // p1/s1/r1 exist; v1 already inserted as PASS

    const FULL_ENUM = ["PASS", "FAIL", "PARTIAL", "CONDITIONAL", "INCONCLUSIVE", "N-A", "SKIP"];
    let i = 0;
    for (const v of FULL_ENUM) {
      // PASS (v1) is already present; insert the rest under fresh ids.
      const id = `enum-${i++}`;
      assert.doesNotThrow(
        () => db.prepare("INSERT INTO verdicts (id,run_id,verdict,reviewer,created_at,updated_at,deleted) VALUES (?,?,?,?,?,?,0)").run(id, "r1", v, "rev", ISO, ISO),
        `CHECK must accept enum value '${v}'`
      );
    }

    assert.throws(
      () => db.prepare("INSERT INTO verdicts (id,run_id,verdict,reviewer,created_at,updated_at,deleted) VALUES (?,?,?,?,?,?,0)").run("bad", "r1", "BOGUS", "rev", ISO, ISO),
      (e) => /CONSTRAINT/i.test(e.code || "") || /CHECK/i.test(e.message),
      "CHECK must reject a value outside the enum"
    );
  } finally {
    db.close();
  }
});

test("applyMigrations is idempotent — a second run applies nothing", { skip: !Database }, () => {
  const db = new Database(":memory:");
  try {
    db.pragma("foreign_keys = ON");
    applyMigrations(db, MIG_DIR);
    const second = applyMigrations(db, MIG_DIR);
    assert.ok(
      second.every((r) => r.status === "already_applied"),
      "re-running the runner must not re-apply any migration"
    );
  } finally {
    db.close();
  }
});
