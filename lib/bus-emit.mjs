/**
 * lib/bus-emit.mjs — fire-and-forget wicked-bus emission.
 *
 * Implements the public event contract defined in docs/INTEGRATION.md § 4.
 * Silently no-ops when wicked-bus is not installed on PATH, so consumers
 * that don't care about events are unaffected. See DATA-DOMAIN.md for the
 * emission sites wired into DomainStore.
 *
 * Invariants:
 *   - Never throws. Failures degrade to `false` return.
 *   - Never blocks the caller beyond a short subprocess spawn.
 *   - Caches binary-presence so the spawn cost is paid once per process.
 *
 * Event catalog (v1) — must match docs/INTEGRATION.md § 4:
 *   wicked.teststrategy.authored
 *   wicked.scenario.authored
 *   wicked.testrun.started
 *   wicked.testrun.finished
 *   wicked.verdict.recorded
 *   wicked.evidence.captured
 */

import { spawnSync } from "node:child_process";

let _busAvailable = null;

// Probe `wicked-bus` once per process. `--version` returns 0 on modern
// wicked-bus; older builds may not support it but the binary still exists,
// so we also accept ENOENT-free exits of `wicked-bus help`.
function busAvailable() {
  if (_busAvailable !== null) return _busAvailable;
  try {
    const r = spawnSync("wicked-bus", ["--version"], { stdio: "ignore", timeout: 2000 });
    if (r.error && r.error.code === "ENOENT") { _busAvailable = false; return false; }
    _busAvailable = true;
    return true;
  } catch {
    _busAvailable = false;
    return false;
  }
}

/**
 * Emit an event via the wicked-bus CLI.
 *
 * @param {string} type    Event type, e.g. "wicked.testrun.finished".
 * @param {object} payload JSON-serializable body. `domain` is forced to
 *                         "wicked-testing"; `emitted_at` stamped here.
 * @returns {boolean}      true if emit spawned cleanly; false if bus absent
 *                         or spawn failed. Never throws.
 */
export function emitBusEvent(type, payload = {}) {
  if (!type || typeof type !== "string") return false;
  if (!busAvailable()) return false;
  const body = {
    event_type: type,
    domain: "wicked-testing",
    emitted_at: new Date().toISOString(),
    ...payload,
  };
  try {
    const res = spawnSync(
      "wicked-bus",
      ["emit", "--type", type, "--domain", "wicked-testing", "--payload", JSON.stringify(body)],
      { stdio: "ignore", timeout: 2000 }
    );
    return res.status === 0;
  } catch {
    return false;
  }
}

/**
 * Map a DomainStore CRUD event to a public event type + enriched payload.
 * Returns null when the action should not produce a public event.
 *
 * @param {"create"|"update"|"delete"} action
 * @param {string} source   Table name ("runs", "verdicts", "scenarios", ...)
 * @param {object|null} record  Post-op record (null on delete)
 * @param {string} wickedTestingVersion
 * @returns {{type: string, payload: object} | null}
 */
export function domainEventToBusEvent(action, source, record, wickedTestingVersion) {
  if (!record) return null;
  const common = {
    project_id: record.project_id,
    wicked_testing_version: wickedTestingVersion,
  };

  if (action === "create") {
    switch (source) {
      case "strategies":
        return {
          type: "wicked.teststrategy.authored",
          payload: { ...common, strategy_id: record.id },
        };
      case "scenarios":
        return {
          type: "wicked.scenario.authored",
          payload: {
            ...common,
            scenario_id: record.id,
            strategy_id: record.strategy_id ?? null,
            format_version: record.format_version ?? null,
          },
        };
      case "runs":
        return {
          type: "wicked.testrun.started",
          payload: {
            ...common,
            run_id: record.id,
            scenario_id: record.scenario_id,
            started_at: record.started_at,
          },
        };
      case "verdicts":
        return {
          type: "wicked.verdict.recorded",
          payload: {
            ...common,
            verdict_id: record.id,
            run_id: record.run_id,
            verdict: record.verdict,
            reviewer: record.reviewer,
            evidence_path: record.evidence_path ?? null,
          },
        };
      default:
        return null;
    }
  }

  if (action === "update" && source === "runs" && record.finished_at) {
    return {
      type: "wicked.testrun.finished",
      payload: {
        ...common,
        run_id: record.id,
        scenario_id: record.scenario_id,
        status: record.status,
        started_at: record.started_at,
        finished_at: record.finished_at,
        evidence_path: record.evidence_path ?? null,
      },
    };
  }

  return null;
}

/**
 * Test-only hook: reset the cached availability probe. Exists so unit tests
 * can re-probe without spawning a new Node process. Do not call from app code.
 */
export function __resetBusAvailabilityForTests() {
  _busAvailable = null;
}
