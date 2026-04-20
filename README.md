# wicked-testing

A self-tracking end-to-end quality engineering team for AI coding CLIs. wicked-testing gives you 6 skills, 6 agents, and 10 commands that work together to plan, write, execute, and judge your tests — with results tracked in a project-local SQLite domain store.

No backend server. No external services. Everything runs inside your AI CLI's conversation, with state stored under `.wicked-testing/` in your project.

---

## Install

```bash
npm install -g wicked-testing
node install.mjs
```

Or install directly into a specific CLI:

```bash
node install.mjs --cli=claude
node install.mjs --path=~/.claude
```

---

## Quick Start

```bash
# 1. Initialize wicked-testing for this project
/wicked-testing:setup

# 2. Generate a test strategy from your codebase
/wicked-testing:plan src/auth/ --project auth-service

# 3. Author test scenario files
/wicked-testing:scenarios "user login feature" --project auth-service

# 4. Run the 3-agent acceptance pipeline on a scenario
/wicked-testing:acceptance scenarios/login-positive.md

# 5. Query your test history
/wicked-testing:oracle "what was the last verdict for the login scenario?"
```

After setup, all commands are available with tab-completion in Claude Code.

---

## All 10 Commands

| Command | Description |
|---------|-------------|
| `/wicked-testing:setup` | Initialize for this project — detect CLI tools, create config, register project |
| `/wicked-testing:plan` | Generate a shift-left test strategy from code or feature description |
| `/wicked-testing:scenarios` | Author self-contained test scenario files in the wicked-testing format |
| `/wicked-testing:automate` | Detect browser tools and scaffold Playwright/Cypress/k6 harnesses |
| `/wicked-testing:run` | Execute a scenario file and write evidence JSON to `.wicked-testing/runs/` |
| `/wicked-testing:acceptance` | 3-agent pipeline: Writer → Executor → Reviewer, verdict written to DomainStore |
| `/wicked-testing:oracle` | Answer plain-language questions about your test data via fixed SQL queries |
| `/wicked-testing:tasks` | List, create, and update testing team work items |
| `/wicked-testing:stats` | Show domain health — row counts, schema version, store mode |
| `/wicked-testing:report` | Generate a markdown summary of run history and verdicts |

All commands support `--json` for machine-readable output.

---

## The Acceptance Testing Pipeline

The `/wicked-testing:acceptance` command runs a 3-agent pipeline that eliminates the 80%+ false-positive rate of self-grading:

```
Writer ──→ Test Plan ──→ Executor ──→ Evidence ──→ Reviewer ──→ Verdict
```

- **Writer**: Reads the scenario + implementation code → structures evidence-gated test plan
- **Executor**: Follows the plan mechanically → captures artifacts, makes NO judgment
- **Reviewer**: Evaluates cold evidence → isolated from executor context (Read-only)

The Reviewer isolation is hard-enforced on Claude Code (`allowed-tools: [Read]`), advisory on other CLIs.

---

## Data Domain

All state lives under `.wicked-testing/` in your project:

```
.wicked-testing/
  config.json              Project configuration + detected capabilities
  wicked-testing.db        SQLite index (better-sqlite3, WAL mode)
  projects/{id}.json       Project records (JSON canonical)
  strategies/{id}.json     Test strategy documents
  scenarios/{id}.json      Scenario registrations
  runs/{run-id}/           Execution evidence per run
    evidence.json
    step-N.json
  verdicts/{id}.json       Reviewer verdicts
  tasks/{id}.json          Work tracking
```

7-table SQLite schema: `projects`, `strategies`, `scenarios`, `runs`, `verdicts`, `tasks`, `schema_migrations`.

On SQLite failure, the store degrades gracefully to JSON-only mode. Oracle and tasks require SQLite; all other commands continue in JSON-only mode.

---

## Scenario Format

Scenarios are self-contained markdown files. See [SCENARIO-FORMAT.md](SCENARIO-FORMAT.md) for the full spec.

Quick example:

```yaml
---
name: api-health-check
description: Verify the API health endpoint returns 200 with correct body
version: "1.0"
category: api
tools:
  required: [curl]
timeout: 30
assertions:
  - id: A1
    description: HTTP 200 response
---

## Steps

### Step 1: Health endpoint returns 200 (curl)

```bash
curl -sf https://api.example.com/health
```

**Expect**: Exit code 0, JSON response
```

---

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — Component diagram, directory layout, key design decisions
- [HOW-IT-WORKS.md](HOW-IT-WORKS.md) — Full E2E narrative walkthrough
- [SCENARIO-FORMAT.md](SCENARIO-FORMAT.md) — Scenario file format spec with 3 examples
- [DATA-DOMAIN.md](DATA-DOMAIN.md) — 7-table schema and DomainStore API surface

---

## Requirements

- Node.js >= 18
- One of: Claude Code, Gemini CLI, Codex, Cursor, Kiro, Copilot
- `better-sqlite3` (installed via `npm install` — pre-built binaries for macOS/Linux/Windows)

## Windows Support

Windows (Git Bash / PowerShell) is best-effort. Pre-built `better-sqlite3` binaries cover Windows x64 (Node 18, 20, 22). All JSON output uses the Python cross-platform fallback pattern per CLAUDE.md. Native PowerShell hook support is deferred to v2.

## License

MIT
