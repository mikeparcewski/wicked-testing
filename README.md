```
           _      _            _       _            _   _             
 __      _(_) ___| | _____  __| |     | |_ ___  ___| |_(_)_ __   __ _ 
 \ \ /\ / / |/ __| |/ / _ \/ _` |_____| __/ _ \/ __| __| | '_ \ / _` |
  \ V  V /| | (__|   <  __/ (_| |_____| ||  __/\__ \ |_| | | | | (_| |
   \_/\_/ |_|\___|_|\_\___|\__,_|      \__\___||___/\__|_|_| |_|\__, |
                                                                 |___/ 
```

**32 specialist agents. 5 coordinating skills. A 3-agent acceptance pipeline that eliminates self-grading.**

```bash
npx wicked-testing install
```

Works with **Claude Code**, **Gemini CLI**, **Copilot CLI**, **Cursor**, **Codex**, and **Kiro**.

---

## The Problem

When you ask an AI agent to test its own work, it grades its own homework. Self-reported PASS rates on agentic test runs sit 80%+ above human-reviewed rates. The agent that wrote the code also runs the tests and evaluates the results — there is no independence at any layer.

The industry answer has been scripted test frameworks: Playwright, pytest, k6, axe-core. But those only run what you already thought to test. They don't tell you what to test, whether the tests are any good, whether the results mean anything, or why the suite keeps failing intermittently on CI.

**wicked-testing gives your AI CLI a complete QE team — from planning through execution through judgment — with enforced separation between the agent that runs tests and the agent that evaluates them.**

---

## What You Get

```bash
claude plugins add mikeparcewski/wicked-testing
```

Then:

```bash
# Generate a shift-left test strategy from your codebase
/wicked-testing:plan src/auth/ --project auth-service

# Run the 3-agent acceptance pipeline with enforced reviewer isolation
/wicked-testing:acceptance scenarios/login-positive.md

# Ask plain-English questions about your test history
/wicked-testing:oracle "what was the last verdict for the login scenario?"
```

Under the hood: a project-local SQLite ledger, 32 specialist agents grouped into 5 skills, and a public event contract for wicked-garden integration.

---

## 32 Agents, 5 Skills

### Tier-1 Agents — Public Contract

The 16 Tier-1 agents form the stable integration surface. wicked-garden and other consumers depend only on these.

| Agent | Invoked By | What It Does |
|-------|-----------|--------------|
| `test-strategist` | `plan` | Maps codebase to test scenarios — positive, negative, edge cases |
| `testability-reviewer` | `plan` | Blocks designs that will be hard to test before a line is written |
| `requirements-quality-analyst` | `plan` | Applies SMART+T to acceptance criteria — ready-for-design or needs-iteration |
| `risk-assessor` | `plan` | Scores risks by likelihood × impact, produces a mitigation matrix |
| `test-designer` | `authoring` | Full write→execute→analyze→verdict loop from a scenario file |
| `test-automation-engineer` | `authoring` | Generates test code in the project's detected framework |
| `contract-testing-engineer` | `authoring` | Consumer-driven contract tests (Pact-style), breaking-change detection |
| `code-analyzer` | `authoring` | Static quality + testability signals, ship/fix/refactor verdict |
| `acceptance-test-writer` | `execution` | Evidence-gated test plan — every step declares expected evidence and an assertion |
| `acceptance-test-executor` | `execution` | Executes plan mechanically, captures artifacts, makes no judgment |
| `acceptance-test-reviewer` | `review` | Reads cold evidence only (`allowed-tools: Read`) — never sees executor context |
| `scenario-executor` | `execution` | Runs a scenario markdown file step-by-step |
| `semantic-reviewer` | `review` | Gap Report per AC: aligned / divergent / missing |
| `continuous-quality-monitor` | `review` | Build-phase quality signals — lint, coverage, complexity coaching |
| `production-quality-engineer` | `insight` | Post-deploy health: healthy / degraded / unhealthy + next action |
| `test-oracle` | `insight` | Plain-English questions → 12 named parameterized SQL queries. No ad-hoc SQL. |

### Tier-2 Specialist Agents — Internal

16 domain specialists routed by the Tier-1 skills. Never break downstream consumers because they are not part of the public contract.

| Specialist | Domain |
|-----------|--------|
| `integration-test-engineer` | Real-service wiring tests — testcontainers, docker compose, no mocks |
| `ui-component-test-engineer` | React/Vue/Svelte component tests — RTL, user-event, role queries |
| `e2e-orchestrator` | Full journey Playwright tests — multi-context, API seeding, journey diagrams |
| `visual-regression-engineer` | Playwright + pixelmatch baselines, dynamic region masking |
| `a11y-test-engineer` | axe-core / pa11y, WCAG 2.1 AA, keyboard flows, focus management |
| `load-performance-engineer` | k6 / locust / hey, P95/P99 assertions, bottleneck diagnosis |
| `chaos-test-engineer` | Toxiproxy / Chaos Mesh failure injection, blast radius, hypothesis→verdict |
| `fuzz-property-engineer` | Hypothesis (Python) / fast-check (TS) / AFL++ — round-trip and invariant testing |
| `mutation-test-engineer` | Stryker / Mutmut / Pitest kill-rate analysis, surviving-mutant triage |
| `localization-test-engineer` | Pseudolocalization, RTL layout, CLDR pluralization, string-length overflow |
| `data-quality-tester` | great_expectations / dbt-test suites, migration forward+rollback, drift detection |
| `observability-test-engineer` | Structured log field assertions, OTel span coverage, cardinality hazard detection, PII-in-signals |
| `flaky-test-hunter` | Reproduce, root-cause, quarantine — never "add retry" as a fix |
| `test-data-manager` | factory_boy / fishery factories, referential consistency, PII-scrubbed snapshots |
| `exploratory-tester` | Charter-driven sessions, SFDIPOT heuristics, ranked findings, follow-up charters |
| `coverage-archaeologist` | lcov + git-blame-age + call-graph ranked by impact × exposure — top-N not 500 |

---

## The 3-Agent Acceptance Pipeline

The `/wicked-testing:acceptance` command eliminates the self-grading problem with enforced role separation:

```
Writer ──→ Test Plan ──→ Executor ──→ Evidence ──→ Reviewer ──→ Verdict
```

- **Writer** (`allowed-tools: Read, Grep, Glob`) — reads scenario + code, produces an evidence-gated plan where every step declares expected evidence and an assertion. Cannot execute or write state.
- **Executor** (`allowed-tools: Read, Write, Bash`) — follows the plan mechanically. Captures stdout, stderr, exit codes, and file artifacts. Makes **no judgment** about results.
- **Reviewer** (`allowed-tools: Read`) — reads cold evidence files only. **Never sees the executor's context, reasoning, or stdout.** Evaluates assertions against artifacts. Cannot execute.

Reviewer isolation is hard-enforced on Claude Code via `allowed-tools` frontmatter, advisory on other CLIs. The separation is what makes the verdict trustworthy.

---

## Commands

| Command | Description |
|---------|-------------|
| `/wicked-testing:setup` | Initialize for this project — detect CLI tools, create config |
| `/wicked-testing:plan` | Shift-left test strategy from code or feature description |
| `/wicked-testing:authoring` | Author scenario files and test code |
| `/wicked-testing:execution` | Run a scenario and capture evidence |
| `/wicked-testing:acceptance` | Full 3-agent pipeline: Writer → Executor → Reviewer |
| `/wicked-testing:review` | Evaluate captured evidence |
| `/wicked-testing:insight` | Domain health, run history, oracle queries |
| `/wicked-testing:oracle` | Plain-language questions about your test history |
| `/wicked-testing:stats` | SQLite ledger health — row counts, schema version, store mode |
| `/wicked-testing:report` | Markdown summary of run history and verdicts |

All commands support `--json` for machine-readable output.

---

## Storage and Integration

```
.wicked-testing/
  config.json              Project configuration + detected capabilities
  wicked-testing.db        SQLite ledger (WAL mode, 7 tables)
  evidence/
    <run-id>/
      manifest.json        PUBLIC contract — read by consumers
      artifacts/
  projects/{id}.json       Canonical JSON (dual-write with SQLite)
  strategies/{id}.json
  scenarios/{id}.json
  runs/{id}.json
  verdicts/{id}.json
  tasks/{id}.json
```

**Dual-write**: every record writes JSON first (fsync'd), then SQLite. On SQLite failure the store degrades to JSON-only. Oracle and task commands require SQLite; all other commands continue in JSON-only mode.

**Provenance**: all records carry `run_id`, `scenario_id`, `agent`, `verdict`, and timestamps — every verdict traces back to the evidence that produced it.

### wicked-bus integration

When wicked-bus is present, wicked-testing emits on every significant action:

| Event | When |
|-------|------|
| `wicked.testrun.started` | Acceptance pipeline begins |
| `wicked.testrun.completed` | Pipeline finishes (any verdict) |
| `wicked.verdict.recorded` | Reviewer writes a verdict |
| `wicked.evidence.captured` | Executor finishes a run |
| `wicked.scenario.registered` | New scenario registered |
| `wicked.oracle.queried` | Oracle answers a question |

If wicked-bus is absent, all emit calls are no-ops (single debug line).

### wicked-brain integration

When wicked-brain is present, wicked-testing writes memories on high-signal events: persistent FAIL patterns, flaky test discoveries, coverage gaps found by the archaeologist. If absent, no-op.

---

## Install

```bash
npx wicked-testing install
```

Detects which AI CLIs are installed (`~/.claude/`, `~/.gemini/`, `~/.codex/`, etc.) and copies skills, agents, and commands into each. Runs a bootstrap self-test to verify the SQLite schema. Idempotent — safe to run multiple times.

```bash
# Install for a specific CLI only
npx wicked-testing install --cli=claude

# Install to a custom path
npx wicked-testing install --path=~/.claude

# Check what's installed
npx wicked-testing status

# Verify the installation is healthy
npx wicked-testing doctor

# Update to the latest version
npx wicked-testing update

# Remove
npx wicked-testing uninstall
```

---

## Scenario Format

Scenarios are self-contained markdown files — the executable unit for the acceptance pipeline.

```yaml
---
name: api-health-check
description: Validate the health endpoint returns 200 with expected JSON
category: api
tools:
  required: [curl]
timeout: 30
---

## Steps

### Step 1: HTTP 200 response (curl)

```bash
curl -sf https://api.example.com/health
```

**Expect**: Exit code 0, JSON response with `status: ok`
```

See [SCENARIO-FORMAT.md](SCENARIO-FORMAT.md) for the full spec. Working examples are in [scenarios/examples/](scenarios/examples/) — start with `smoke-test-execution.md` to verify the pipeline fires real commands.

---

## Documentation

| Doc | For |
|-----|-----|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Library maintainers — component diagram, design decisions |
| [HOW-IT-WORKS.md](HOW-IT-WORKS.md) | Walkthrough of the full E2E pipeline |
| [SCENARIO-FORMAT.md](SCENARIO-FORMAT.md) | Scenario file spec with examples |
| [DATA-DOMAIN.md](DATA-DOMAIN.md) | 7-table SQLite schema and DomainStore API |
| [docs/INTEGRATION.md](docs/INTEGRATION.md) | Consumers integrating with wicked-testing |
| [docs/EVIDENCE.md](docs/EVIDENCE.md) | Evidence manifest schema |
| [docs/NAMESPACE.md](docs/NAMESPACE.md) | Naming rules for skills and agents |
| [docs/STANDALONE.md](docs/STANDALONE.md) | Using without wicked-garden |
| [docs/WICKED-GARDEN.md](docs/WICKED-GARDEN.md) | wicked-garden integration guide |

---

## Requirements

- Node.js ≥ 18
- One of: Claude Code, Gemini CLI, Codex, Cursor, Kiro, Copilot
- `better-sqlite3` — installed via `npm install`, pre-built binaries for macOS/Linux/Windows x64

Windows (Git Bash / WSL) is fully supported. Native PowerShell hook support is planned for v2.

## License

MIT
