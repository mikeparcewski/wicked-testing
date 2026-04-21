# How It Works — wicked-testing End-to-End Walkthrough

This document walks through the full E2E flow: from running `/wicked-testing:acceptance scenario.md` through to `/wicked-testing:oracle` answering a question about the result.

---

## The Full Pipeline

```
User: /wicked-testing:acceptance scenarios/test-runner.md
        |
        v
[1] acceptance-testing skill activates
        - Reads scenario.md from disk
        - Parses frontmatter (name, assertions, tags)
        - Resolves project from .wicked-testing/config.json
        - Ensures project + scenario rows exist in DomainStore
        - Creates run record: status = 'running'
        |
        v
[2] Dispatches acceptance-test-writer (subagent)
        allowed-tools: Read, Grep, Glob
        - Reads scenario.md + implementation code
        - Produces structured test plan:
          { steps, evidence_gates, assertions }
        - Writes test plan to evidence directory
        - Returns test plan to parent skill
        |
        v
[3] Dispatches acceptance-test-executor (subagent)
        allowed-tools: Read, Write, Bash
        - Receives: scenario path + test plan
        - Creates run directory: .wicked-testing/evidence/{run-id}/
        - Executes each step via Bash
        - Captures: stdout, stderr, exit codes, file artifacts
        - Writes evidence files:
            .wicked-testing/evidence/{run-id}/evidence.json
            .wicked-testing/evidence/{run-id}/step-N.json
        - Does NOT judge results — only records what happened
        |
        v
[4] Dispatches acceptance-test-reviewer (subagent)
        allowed-tools: Read        <-- READ ONLY. Hard-enforced on Claude Code.
        - Receives ONLY:
            * scenario.md path (for assertion reference)
            * evidence directory path
            * test plan
        - NEVER receives: executor stdout, executor reasoning, executor context
        - Reads evidence files independently via Read tool
        - Evaluates each assertion against evidence
        - Returns verdict: { verdict: 'PASS' | 'FAIL', reasons: [...] }
        |
        v
[5] DomainStore writes (dual-write: JSON + SQLite)
        store.update('runs', run.id, {
          finished_at, status: 'passed' | 'failed',
          evidence_path: '.wicked-testing/evidence/{run-id}'
        });
        store.create('verdicts', {
          run_id, verdict: 'PASS',
          reviewer: 'acceptance-test-reviewer',
          reason: '...'
        });
        -- JSON written first (fsync), then SQLite row inside transaction --
        |
        v
[6] User sees verdict
        ## Acceptance Test Results: test-runner-self-test
        ### Verdict: PASS
        Evidence: .wicked-testing/evidence/{run-id}/
        Run ID: {run-id}
        |
        v
[7] Oracle query
        User: /wicked-testing:oracle "what was the verdict for the bootstrap run?"
        |
        test-oracle agent activates
        - Maps question to named query: last_verdict_for_scenario
        - Runs parameterized SQL:
            SELECT v.verdict, v.created_at, v.reason
            FROM verdicts v
            JOIN runs r ON v.run_id = r.id
            JOIN scenarios s ON r.scenario_id = s.id
            WHERE s.name = 'test-runner-self-test'
            ORDER BY v.created_at DESC LIMIT 1
        - Returns: PASS | 2026-04-10T14:05:21Z | Bootstrap self-test passed
```

---

## Step-by-Step: What Happens in Each Component

### install.mjs

Runs `node install.mjs`. Detects installed AI CLIs (claude, gemini, codex, kiro, cursor). Copies `skills/`, `agents/`, and `commands/` into each CLI's plugin directory. Runs the bootstrap self-test: initializes the SQLite store, creates a bootstrap project/scenario/run/verdict, verifies the schema. Exits 0 on success.

### .wicked-testing/config.json

Created by `/wicked-testing:setup`. Records the project name and detected CLI capabilities (playwright installed: true/false, cypress: true/false, etc.). All commands check for this file — if missing, they return `ERR_NO_CONFIG`.

### lib/domain-store.mjs

Singleton-per-process DomainStore. On construction:
1. Opens/creates `.wicked-testing/wicked-testing.db`
2. Applies `lib/schema.sql` (idempotent `CREATE TABLE IF NOT EXISTS`)
3. Checks schema version against `SCHEMA_VERSION = 1`
4. Prepares INSERT statements for all 7 tables
5. Enables WAL mode for concurrent readers

Every `create()` call:
1. Assigns UUID via `crypto.randomUUID()`
2. Writes `{source}/{id}.json` atomically (tmp + fdatasync + rename)
3. Inserts SQLite row inside `db.transaction()`
4. On SQLite failure: retains JSON, logs warning, continues

### lib/oracle-queries.mjs

Fixed library of 12 named queries. `routeQuestion(question, filters)` does keyword matching to pick the right query name. `buildOracleQuery(name, args)` returns `{ sql, params }` ready for `db.prepare(sql).all(...params)`. No dynamic SQL.

### The 3-Agent Acceptance Pipeline

The key insight: **three separate subagent invocations with non-overlapping permissions**.

- **Writer** reads scenario + code. Cannot execute (no Bash). Cannot modify state.
- **Executor** executes steps and captures artifacts. Cannot evaluate — only records.
- **Reviewer** reads cold evidence files. Cannot execute (no Bash). Cannot write (no Write). Cannot see executor's conversation history.

This separation is what eliminates the self-grading false-positive rate.

---

## Data Flow: What Gets Written Where

After `/wicked-testing:acceptance scenarios/test-runner.md` completes:

```
.wicked-testing/
  config.json                      -- project config
  projects/{project-id}.json       -- project JSON (canonical)
  scenarios/{scenario-id}.json     -- scenario JSON (canonical)
  runs/{run-id}/
    evidence.json                  -- overall run summary
    step-1.json                    -- per-step evidence
    step-2.json
    ...
  verdicts/{verdict-id}.json       -- reviewer's verdict JSON
  wicked-testing.db                -- SQLite index (all of the above as rows)
```

---

## Error Paths

| What fails | What happens |
|-----------|-------------|
| `better-sqlite3` fails to load | Store degrades to JSON-only; oracle/tasks return `ERR_SQLITE_UNAVAILABLE` |
| Scenario file not found | Command returns `ERR_SCENARIO_NOT_FOUND` |
| No config.json | Command returns `ERR_NO_CONFIG` |
| SQLite row INSERT fails | JSON retained, warning to stderr, drift count incremented |
| DB newer than code (version > 1) | Refuse to write, print upgrade message |
| Oracle question matches no query | Return list of supported patterns, no crash |
| Invalid filter value | Return `ERR_FILTER_INVALID`, no crash |
| Reviewer receives missing evidence | Return `INCONCLUSIVE` verdict, not FAIL |

---

## The Self-Test Bootstrap (Criterion 22)

When you run `node install.mjs`, the installer:

1. Copies all plugin files
2. Tries to import `lib/domain-store.mjs`
3. Creates a bootstrap project, scenario, run, and verdict
4. Verifies the schema version
5. Reports PASS or FAIL

After install, you can verify with:

```bash
/wicked-testing:acceptance scenarios/test-runner.md
/wicked-testing:oracle "show bootstrap verdict"
```

The oracle query confirms the full pipeline: create project → create scenario → create run → create verdict → query verdict.
