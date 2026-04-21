/**
 * lib/domain-store.mjs — wicked-testing DomainStore
 *
 * Node.js port of wicked-garden's _domain_store.py.
 * Dual-write: JSON canonical + SQLite index (better-sqlite3).
 * Graceful degradation: if better-sqlite3 fails to load, JSON-only mode.
 *
 * Divergences from reference (see DATA-DOMAIN.md §3):
 *   - Language: Python → Node.js ESM
 *   - Storage: home-global → project-local (.wicked-testing/)
 *   - Integration routing: removed (local-only)
 *   - Event emission: routes CRUD ops to lib/bus-emit.mjs (best-effort fire-and-forget)
 *   - Synchronous-only API (fs.writeFileSync, better-sqlite3 sync)
 *   - schema_migrations table + strict version check
 *   - Per-query prepared-statement cache
 *
 * API surface (matches reference CRUD method names):
 *   store.create(source, payload) → Object
 *   store.list(source, params)    → Array<Object>
 *   store.get(source, id)         → Object | null
 *   store.update(source, id, diff)→ Object | null
 *   store.delete(source, id)      → boolean
 *   store.search(source, q, params) → Array<Object>
 *   store.schemaVersion()         → number
 *   store.rebuildIndex()          → void
 *   store.close()                 → void
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync, readdirSync, fdatasyncSync, openSync, closeSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { emitBusEvent, domainEventToBusEvent } from "./bus-emit.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// --- SQLite driver load (graceful degradation) ---
let Database = null;

try {
  const require = createRequire(import.meta.url);
  Database = require("better-sqlite3");
} catch (err) {
  process.stderr.write(
    `[wicked-testing] better-sqlite3 failed to load — domain store will be JSON-only until you reinstall or run 'npm rebuild better-sqlite3'.\n  Reason: ${err.message}\n`
  );
}

// --- Constants ---
const SCHEMA_VERSION = 1;
const TABLES = ["projects", "strategies", "scenarios", "runs", "verdicts", "tasks"];

// Read our own package version so bus events carry it (per INTEGRATION.md
// common-fields contract). Best-effort: if package.json cannot be read for
// any reason (packaged differently, stripped during publish), fall back to
// an empty string — events still fire, they just omit that field.
let _pkgVersion = "";
try {
  const pkgPath = join(__dirname, "..", "package.json");
  _pkgVersion = JSON.parse(readFileSync(pkgPath, "utf8")).version ?? "";
} catch (_) { /* leave as "" */ }

// Column lists per table (used for INSERT/UPDATE prepared statements)
const TABLE_COLUMNS = {
  projects:   ["id", "name", "description", "created_at", "updated_at", "deleted", "deleted_at"],
  strategies: ["id", "project_id", "name", "body", "created_at", "updated_at", "deleted", "deleted_at"],
  scenarios:  ["id", "project_id", "strategy_id", "name", "format_version", "body", "source_path", "created_at", "updated_at", "deleted", "deleted_at"],
  runs:       ["id", "project_id", "scenario_id", "started_at", "finished_at", "status", "evidence_path", "created_at", "updated_at", "deleted", "deleted_at"],
  verdicts:   ["id", "run_id", "verdict", "evidence_path", "reviewer", "reason", "created_at", "updated_at", "deleted", "deleted_at"],
  tasks:      ["id", "project_id", "title", "body", "status", "assignee_skill", "created_at", "updated_at", "deleted", "deleted_at"],
};

// --- Utility ---
function now() {
  return new Date().toISOString();
}

function atomicWriteJson(filePath, data) {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = filePath + ".tmp." + Date.now();
  const content = JSON.stringify(data, null, 2);
  writeFileSync(tmp, content, "utf8");
  // fsync the temp file
  try {
    const fd = openSync(tmp, "r");
    fdatasyncSync(fd);
    closeSync(fd);
  } catch (_) {
    // fdatasync may not be available on all platforms — continue
  }
  renameSync(tmp, filePath);
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

// --- DomainStore class ---
export class DomainStore {
  constructor(root) {
    this._root = root;
    this._db = null;
    this._stmts = {};
    this._sqliteAvailable = false;
    this._driftCount = 0;

    mkdirSync(root, { recursive: true });

    if (Database) {
      this._initDb();
    }
  }

  _initDb() {
    const dbPath = join(this._root, "wicked-testing.db");
    try {
      this._db = new Database(dbPath);
      this._db.pragma("journal_mode = WAL");
      this._db.pragma("foreign_keys = ON");

      // Apply schema
      const schemaSql = readFileSync(join(__dirname, "schema.sql"), "utf8");
      this._db.exec(schemaSql);

      // Check schema version
      const versionRow = this._db
        .prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1")
        .get();

      if (versionRow && versionRow.version > SCHEMA_VERSION) {
        this._db.close();
        this._db = null;
        throw new Error(
          `wicked-testing.db was written by a newer version (DB v${versionRow.version}, code v${SCHEMA_VERSION}). ` +
          `Upgrade the plugin with: npm install -g wicked-testing`
        );
      }

      this._sqliteAvailable = true;
      this._prepareStatements();
    } catch (err) {
      process.stderr.write(`[wicked-testing] SQLite init failed: ${err.message}\n`);
      this._db = null;
    }
  }

  _prepareStatements() {
    if (!this._db) return;
    // Prepare INSERT statements for each table
    for (const [table, cols] of Object.entries(TABLE_COLUMNS)) {
      const colList = cols.join(", ");
      const placeholders = cols.map((c) => "@" + c).join(", ");
      this._stmts[`insert_${table}`] = this._db.prepare(
        `INSERT INTO ${table} (${colList}) VALUES (${placeholders})`
      );
    }

    // Prepare soft-delete statement for each table
    for (const table of TABLES) {
      this._stmts[`soft_delete_${table}`] = this._db.prepare(
        `UPDATE ${table} SET deleted = 1, deleted_at = @deleted_at, updated_at = @updated_at WHERE id = @id`
      );
    }
  }

  // --- JSON path helper ---
  _jsonPath(source, id) {
    return join(this._root, source, `${id}.json`);
  }

  // --- SQLite write helpers ---
  _dbInsert(table, record) {
    if (!this._sqliteAvailable) return;
    try {
      const stmt = this._stmts[`insert_${table}`];
      if (!stmt) return;
      const params = {};
      const cols = TABLE_COLUMNS[table];
      for (const col of cols) {
        params[col] = record[col] ?? null;
      }
      const doInsert = this._db.transaction(() => stmt.run(params));
      doInsert();
    } catch (err) {
      this._driftCount++;
      process.stderr.write(`[wicked-testing] SQLite write failed for ${table}/${record.id}: ${err.message}\n`);
    }
  }

  _dbUpdate(table, id, fields) {
    if (!this._sqliteAvailable) return;
    try {
      // Column-name allowlist: filter to schema columns only (prevents field-name injection)
      const allowed = TABLE_COLUMNS[table] || [];
      const safeFields = Object.fromEntries(
        Object.entries(fields).filter(([k]) => allowed.includes(k))
      );
      if (Object.keys(safeFields).length === 0) return;
      const setClauses = Object.keys(safeFields).map((k) => `${k} = @${k}`).join(", ");
      const stmt = this._db.prepare(`UPDATE ${table} SET ${setClauses} WHERE id = @_id`);
      const doUpdate = this._db.transaction(() => stmt.run({ ...fields, _id: id }));
      doUpdate();
    } catch (err) {
      this._driftCount++;
      process.stderr.write(`[wicked-testing] SQLite update failed for ${table}/${id}: ${err.message}\n`);
    }
  }

  // --- CRUD: create ---
  create(source, payload) {
    const record = {
      id: payload.id || randomUUID(),
      ...payload,
      created_at: payload.created_at || now(),
      updated_at: payload.updated_at || now(),
      deleted: 0,
      deleted_at: null,
    };

    // 1. Atomic JSON write
    atomicWriteJson(this._jsonPath(source, record.id), record);

    // 2. SQLite insert inside transaction
    this._dbInsert(source, record);

    // 3. No-op event hook for v2
    this._emitEvent("create", source, record.id, record);

    return record;
  }

  // --- CRUD: get ---
  get(source, id) {
    if (this._sqliteAvailable) {
      try {
        const row = this._db.prepare(`SELECT * FROM ${source} WHERE id = ? AND deleted = 0`).get(id);
        if (!row) return null;
        return row;
      } catch (_) {
        // Fall through to JSON
      }
    }
    const data = readJson(this._jsonPath(source, id));
    if (!data || data.deleted) return null;
    return data;
  }

  // --- CRUD: list ---
  list(source, params = {}) {
    // Column-name allowlist: reject any key not in the schema to prevent injection
    const allowed = TABLE_COLUMNS[source] || [];
    const safeParams = Object.fromEntries(
      Object.entries(params).filter(([k]) => allowed.includes(k))
    );

    if (this._sqliteAvailable) {
      try {
        let query = `SELECT * FROM ${source} WHERE deleted = 0`;
        const bindings = [];
        for (const [key, val] of Object.entries(safeParams)) {
          if (key === "deleted") continue; // handled above
          query += ` AND ${key} = ?`;
          bindings.push(val);
        }
        query += " ORDER BY created_at DESC";
        return this._db.prepare(query).all(...bindings);
      } catch (_) {
        // Fall through to JSON
      }
    }

    // JSON-only fallback
    const dir = join(this._root, source);
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    let results = files
      .map((f) => readJson(join(dir, f)))
      .filter((r) => r && !r.deleted);

    // Filter by safeParams (column allowlist already applied above)
    for (const [key, val] of Object.entries(safeParams)) {
      if (key === "deleted") continue;
      results = results.filter((r) => r[key] === val);
    }

    return results.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  }

  // --- CRUD: update ---
  update(source, id, diff) {
    const jsonPath = this._jsonPath(source, id);
    const existing = readJson(jsonPath);
    if (!existing) return null;

    const updated = {
      ...existing,
      ...diff,
      updated_at: now(),
    };

    // 1. Atomic JSON write
    atomicWriteJson(jsonPath, updated);

    // 2. SQLite update
    const sqlFields = { ...diff, updated_at: updated.updated_at };
    this._dbUpdate(source, id, sqlFields);

    this._emitEvent("update", source, id, updated);
    return updated;
  }

  // --- CRUD: delete (soft) ---
  delete(source, id) {
    const jsonPath = this._jsonPath(source, id);
    const existing = readJson(jsonPath);
    if (!existing) return false;

    const deletedAt = now();
    const updated = {
      ...existing,
      deleted: 1,
      deleted_at: deletedAt,
      updated_at: deletedAt,
    };

    // 1. Atomic JSON write
    atomicWriteJson(jsonPath, updated);

    // 2. SQLite soft-delete
    if (this._sqliteAvailable) {
      try {
        const stmt = this._stmts[`soft_delete_${source}`];
        if (stmt) {
          const doDelete = this._db.transaction(() =>
            stmt.run({ id, deleted_at: deletedAt, updated_at: deletedAt })
          );
          doDelete();
        }
      } catch (err) {
        this._driftCount++;
        process.stderr.write(`[wicked-testing] SQLite delete failed for ${source}/${id}: ${err.message}\n`);
      }
    }

    this._emitEvent("delete", source, id, null);
    return true;
  }

  // --- search ---
  search(source, q, params = {}) {
    const results = this.list(source, params);
    if (!q) return results;
    const lower = q.toLowerCase();
    return results.filter((r) => {
      return ["title", "content", "summary", "description", "tags", "name", "body"].some(
        (field) => typeof r[field] === "string" && r[field].toLowerCase().includes(lower)
      );
    });
  }

  // --- Schema version ---
  schemaVersion() {
    if (this._sqliteAvailable) {
      try {
        const row = this._db
          .prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1")
          .get();
        return row ? row.version : 0;
      } catch (_) {}
    }
    return SCHEMA_VERSION; // Default when JSON-only
  }

  // --- Rebuild index from JSON ---
  rebuildIndex() {
    if (!this._sqliteAvailable) {
      throw Object.assign(new Error("SQLite unavailable — cannot rebuild index"), {
        code: "ERR_SQLITE_UNAVAILABLE",
      });
    }

    const dropAndRecreate = this._db.transaction(() => {
      // Drop all tables
      for (const table of [...TABLES, "schema_migrations"]) {
        this._db.exec(`DROP TABLE IF EXISTS ${table}`);
      }
      // Re-apply schema
      const schemaSql = readFileSync(join(__dirname, "schema.sql"), "utf8");
      this._db.exec(schemaSql);
    });
    dropAndRecreate();

    // Re-prepare statements after schema rebuild
    this._prepareStatements();

    // Scan JSON files and re-insert
    for (const source of TABLES) {
      const dir = join(this._root, source);
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        const record = readJson(join(dir, file));
        if (record) {
          this._dbInsert(source, record);
        }
      }
    }
  }

  // --- Stats (row counts per table) ---
  stats() {
    if (!this._sqliteAvailable) {
      // JSON-only fallback: count files
      const counts = {};
      for (const source of TABLES) {
        const dir = join(this._root, source);
        if (existsSync(dir)) {
          counts[source] = readdirSync(dir).filter((f) => f.endsWith(".json")).length;
        } else {
          counts[source] = 0;
        }
      }
      return { mode: "json-only", counts, drift_count: this._driftCount };
    }

    const counts = {};
    for (const source of TABLES) {
      try {
        const row = this._db.prepare(`SELECT COUNT(*) as n FROM ${source} WHERE deleted = 0`).get();
        counts[source] = row ? row.n : 0;
      } catch (_) {
        counts[source] = 0;
      }
    }
    return {
      mode: "sqlite+json",
      counts,
      schema_version: this.schemaVersion(),
      drift_count: this._driftCount,
    };
  }

  // --- Bus emission hook ---
  // Maps CRUD action + table to a public event per INTEGRATION.md § 4.
  // Emission is fire-and-forget: if wicked-bus is absent or the spawn fails,
  // nothing blocks the write. Never throws — bus-emit swallows its own errors.
  _emitEvent(action, source, _id, record) {
    const ev = domainEventToBusEvent(action, source, record, _pkgVersion);
    if (ev) emitBusEvent(ev.type, ev.payload);
  }

  // --- Close DB ---
  close() {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }

  // --- Mode ---
  get mode() {
    return this._sqliteAvailable ? "sqlite+json" : "json-only";
  }
}

// --- Factory function ---
export function createDomainStore(opts = {}) {
  const root = opts.root || join(process.cwd(), ".wicked-testing");
  return new DomainStore(root);
}

export default createDomainStore;
