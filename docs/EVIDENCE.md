# Evidence Store Layout

Evidence is wicked-testing's **proof of work**: the artifacts a test produced
(screenshots, logs, curl output, stack traces) plus a manifest that names the
verdict. This document is the **public contract** for how evidence is stored
and read.

See [INTEGRATION.md](INTEGRATION.md) for how this ties into the bus and brain.

---

## 1. Storage Model

Evidence is always **project-local**:

```
<project-root>/.wicked-testing/
  wicked-testing.db             # SQLite ledger (internal — not a contract)
  evidence/
    <run-id>/                   # one directory per test run (UUID v4)
      manifest.json             # verdict + artifact index  ← PUBLIC CONTRACT
      artifacts/
        <name>.<ext>            # screenshots, logs, outputs, traces
```

No home-global store. A project's full test history lives beside its code and
is portable by directory copy.

---

## 2. `manifest.json` Schema (public)

Formal JSON Schema: [`schemas/evidence.json`](../schemas/evidence.json)

```jsonc
{
  "manifest_version": "1.0.0",
  "run_id": "b47ac10b-58cc-4372-a567-0e02b2c3d479",
  "project_id": "d290f1ee-6c54-4b01-90e6-d701748f0851",
  "scenario_id": "8ea1a56f-1b6a-4c9b-9a2f-2b8b3c3e5d7a",
  "scenario_name": "login-with-bad-credentials",
  "scenario_path": "scenarios/auth/login-bad-creds.md",
  "started_at":  "2026-04-20T14:03:12.004Z",
  "finished_at": "2026-04-20T14:03:15.221Z",
  "duration_ms": 3217,
  "status":  "failed",              // passed | failed | errored | skipped
  "verdict": {
    "value":     "FAIL",            // PASS | FAIL | N-A | SKIP
    "reviewer":  "wicked-testing:acceptance-test-reviewer",
    "reason":    "Step 3 assertion: expected 401, got 200",
    "recorded_at": "2026-04-20T14:03:16.103Z"
  },
  "environment": {
    "os":        "darwin",
    "node":      "v20.11.1",
    "cli":       "claude-code",
    "wicked_testing_version": "0.1.0"
  },
  "artifacts": [
    {
      "name":         "step-1-login-form.png",
      "kind":         "screenshot",
      "path":         "artifacts/step-1-login-form.png",
      "bytes":        48213,
      "sha256":       "7d8f…",
      "captured_at":  "2026-04-20T14:03:13.402Z"
    },
    {
      "name":         "step-3-response.json",
      "kind":         "http-response",
      "path":         "artifacts/step-3-response.json",
      "bytes":        412,
      "sha256":       "9b2a…",
      "captured_at":  "2026-04-20T14:03:14.801Z"
    },
    {
      "name":         "run.log",
      "kind":         "log",
      "path":         "artifacts/run.log",
      "bytes":        8192,
      "sha256":       "42f1…",
      "captured_at":  "2026-04-20T14:03:15.220Z"
    }
  ],
  "assertions": [
    { "id": "a1", "description": "Login form visible",       "passed": true  },
    { "id": "a2", "description": "Invalid creds rejected",   "passed": false,
      "expected": "HTTP 401", "actual": "HTTP 200" }
  ]
}
```

### Field rules

| Field                 | Required | Notes                                                |
|-----------------------|----------|------------------------------------------------------|
| `manifest_version`    | yes      | Semver. Bumped on any schema-breaking change.        |
| `run_id`              | yes      | UUID v4. Matches the bus event `run_id`.             |
| `project_id`          | yes      | UUID v4. Matches the bus event `project_id`.         |
| `scenario_id`         | yes      | UUID v4.                                             |
| `scenario_name`       | yes      | Human-readable identifier.                           |
| `scenario_path`       | no       | Present when scenario came from a file.              |
| `started_at`          | yes      | ISO 8601 UTC with `Z`.                               |
| `finished_at`         | yes      | ISO 8601 UTC with `Z`.                               |
| `duration_ms`         | yes      | Integer milliseconds.                                |
| `status`              | yes      | `passed | failed | errored | skipped`.               |
| `verdict.value`       | yes      | `PASS | FAIL | N-A | SKIP`.                          |
| `verdict.reviewer`    | yes      | Agent subagent_type that judged.                     |
| `verdict.reason`      | when FAIL/N-A/SKIP | Free text. ≤ 500 chars recommended.        |
| `environment.*`       | yes      | Best-effort capture at run start.                    |
| `artifacts[]`         | yes      | Empty array allowed for `skipped`.                   |
| `artifacts[].kind`    | yes      | See table below.                                     |
| `artifacts[].sha256`  | yes      | Integrity. Readers may verify before trusting.       |
| `assertions[]`        | no       | Present when scenario had explicit assertions.       |

### Artifact kinds

| Kind             | Typical content                            |
|------------------|--------------------------------------------|
| `screenshot`     | PNG/JPEG                                   |
| `video`          | MP4/WebM                                   |
| `http-response`  | JSON, XML, or raw body                     |
| `http-request`   | Method + URL + headers + body              |
| `log`            | Plain text log lines                       |
| `stack-trace`    | Exception / stack dump                     |
| `metric`         | Perf or coverage sample                    |
| `trace`          | OpenTelemetry JSON                         |
| `coverage`       | LCOV / cobertura / JSON                    |
| `diff`           | Unified diff (e.g. visual regression)      |
| `misc`           | Anything else                              |

---

## 3. Evidence Directory Rules

1. **Immutable after verdict.** Once `verdict.recorded_at` is written, nothing
   in the directory may change. Corrections are recorded as a new run.
2. **Self-contained.** A run directory can be zipped and shared; consumers
   should not need the project's database to read it.
3. **Artifact paths are relative** to `manifest.json`. Absolute paths are
   forbidden.
4. **`sha256`** is hex-encoded, 64 chars, lowercase.
5. **Writable by wicked-testing only.** External tools should write alongside,
   not inside, the run directory.

---

## 4. Retention

Default retention: **unbounded** (evidence is cheap; deletion is a human
decision). wicked-testing provides a prune command but never prunes
automatically.

```
npx wicked-testing prune --older-than 90d          # dry-run by default
npx wicked-testing prune --older-than 90d --apply  # actually delete
npx wicked-testing prune --keep-failed             # keep all FAIL verdicts
```

Bus event is emitted when a run directory is pruned
(`wicked.evidence.pruned`, tier-1 IDs only).

---

## 5. How Consumers Read Evidence

### Normal path (via bus event)

1. Subscribe to `wicked.verdict.recorded` (domain: `wicked-testing`).
2. Read `evidence_path` from the payload.
3. Open `<evidence_path>/manifest.json`.
4. Iterate `artifacts[]`, optionally verify `sha256`.

### Direct query (without bus)

Consumers may scan `<project-root>/.wicked-testing/evidence/*/manifest.json`
directly. This is supported and stable. SQLite access is **not** stable.

### What NOT to read

- The SQLite `wicked-testing.db` file (schema can change across minor versions).
- Any file under `.wicked-testing/` except `evidence/*/manifest.json` and the
  artifacts it indexes.

---

## 6. Multi-Run Queries

For "has this scenario passed recently?" / "flake rate" style queries, use the
`test-oracle` via `/wicked-testing:oracle <question>` or `npx wicked-testing
oracle <question>`. It dispatches to fixed SQL that treats the ledger as an
internal index — consumers get stable answers without depending on the schema.

---

## 7. Compatibility

- `manifest_version` follows semver.
- Minor bumps add optional fields. Major bumps change or remove fields.
- Readers should ignore unknown fields for forward compatibility.
- The path structure (`<project-root>/.wicked-testing/evidence/<run-id>/`) is
  stable across minor versions.
