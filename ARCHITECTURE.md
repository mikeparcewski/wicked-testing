# Architecture — wicked-testing

Standalone QE library for AI coding CLIs. Ships as an npm package; installs
skills, agents, and commands into the host CLI's plugin directory. Optional
integration with wicked-bus (events) and wicked-brain (knowledge memory).

See [docs/INTEGRATION.md](docs/INTEGRATION.md) for the public contract,
[docs/EVIDENCE.md](docs/EVIDENCE.md) for the evidence manifest schema, and
[docs/NAMESPACE.md](docs/NAMESPACE.md) for naming rules.

---

## Design Principle: 5 Core + Specialists

User-centric, not taxonomy-centric. The surface is five skills named after
what a user actually wants to do:

| Skill                       | User intent                                    |
|-----------------------------|------------------------------------------------|
| `wicked-testing:plan`       | What should I test? Is this testable?          |
| `wicked-testing:authoring`  | Write the tests                                |
| `wicked-testing:execution`  | Run them and prove it                          |
| `wicked-testing:review`     | Judge the evidence                             |
| `wicked-testing:insight`    | Is my suite healthy? What happened last week?  |

Behind the five Tier-1 skills sit specialist agents. **Tier 1** (stable,
public contract) covers strategy, testability, risk, automation, execution,
review, oracle. **Tier 2** (internal, grows freely) covers domain specialists:
integration, ui-component, e2e, visual, a11y, load, chaos, fuzz, mutation,
i18n, data-quality, observability, flaky-hunter, exploratory,
coverage-archaeologist.

Consumers (notably wicked-garden) only depend on Tier 1. Adding Tier-2
specialists never breaks downstream.

---

## Component Diagram

```
User --> AI CLI (Claude / Gemini / Codex / Cursor / Kiro / Copilot)
              |
              v
         wicked-testing plugin
              |
              +-- 5 Tier-1 skills (SKILL.md files)
              |     plan, authoring, execution, review, insight
              |
              +-- 16 Tier-1 agents (public contract)
              |     test-strategist, test-designer, test-automation-engineer,
              |     testability-reviewer, requirements-quality-analyst,
              |     risk-assessor, code-analyzer, semantic-reviewer,
              |     contract-testing-engineer, continuous-quality-monitor,
              |     production-quality-engineer, acceptance-test-writer,
              |     acceptance-test-executor, acceptance-test-reviewer,
              |     scenario-executor, test-oracle
              |
              +-- 10 commands (/wicked-testing:*)
              |     plan, authoring, execution, review, insight,
              |     setup, oracle, tasks, stats, report
              |
              +-- lib/
              |     domain-store.mjs  -- SQLite ledger + JSON canonical
              |     oracle-queries.mjs -- 12 fixed parameterized queries
              |     schema.sql         -- 7-table DDL
              |     migrations/
              |
              +-- schemas/
                    evidence.json -- public manifest schema

Optional integrations (graceful degradation):
         |
         +--> wicked-bus ........ emits verdict / run / evidence events
         +--> wicked-brain ...... writes failure-pattern / flake-signal memories
```

---

## Distribution Model

Mirrors [wicked-bus](https://github.com/mikeparcewski/wicked-bus):

1. wicked-testing is published to npm with `bin` entries (`wicked-testing`,
   `wicked-testing-install`).
2. `npx wicked-testing install` copies skills, agents, and commands into
   the detected AI CLI directories (`~/.claude/`, `~/.gemini/`, etc.).
3. Once copied, everything runs native in the host CLI — no per-call `npx`.
4. `npx wicked-testing update` refreshes. `npx wicked-testing uninstall`
   removes.

The installer is idempotent and version-aware (tracks the installed version
in a marker file per CLI target).

### CLI subcommands

```
npx wicked-testing [install | update | uninstall | status | doctor | version | help]
  --cli=<list>   restrict to specific CLIs
  --path=<dir>   custom install target
  --force        overwrite regardless of installed version
  --json         machine-readable output
```

---

## Storage: Project-Local, Dual-Write

All wicked-testing state lives in `<project-root>/.wicked-testing/`:

```
.wicked-testing/
  wicked-testing.db             (internal SQLite ledger — NOT public contract)
  evidence/
    <run-id>/
      manifest.json             (PUBLIC contract — see docs/EVIDENCE.md)
      artifacts/
```

Writes are dual-write: JSON canonical first (fsync'd), SQLite index second.
If SQLite fails, JSON is retained; the store degrades to JSON-only.

Consumers read `evidence/<run-id>/manifest.json`, never the database.

---

## Integration Surface

The public contract for consumers is three things:

1. **Tier-1 skill and agent names** — see [docs/INTEGRATION.md](docs/INTEGRATION.md) § 2–3.
2. **Bus events** — `wicked.testrun.*`, `wicked.verdict.recorded`,
   `wicked.evidence.captured` — see [docs/INTEGRATION.md](docs/INTEGRATION.md) § 4.
3. **Evidence manifest schema** — `schemas/evidence.json`.

Consumers should not read the SQLite database, anything under `lib/`, or
Tier-2 agent names directly.

### Graceful Degradation

| Dependency      | Present                               | Absent                          |
|-----------------|---------------------------------------|---------------------------------|
| SQLite          | Ledger writes + oracle queries        | Required; fails loud            |
| wicked-bus      | Emit events on every significant act  | No-op (single debug line)       |
| wicked-brain    | Write memories on interesting signals | No-op (single debug line)       |
| wicked-garden   | Consumes bus events via crew gate     | N/A (downstream)                |

---

## Key Design Decisions (preserved)

### 1. better-sqlite3 (ADR-0001)
Synchronous API matches the skill model. Pre-built binaries cover macOS,
Linux, Windows. Graceful degradation to JSON-only if load fails.

### 2. Dual-Write: JSON Canonical + SQLite Index
Every domain write produces a JSON file and an SQLite row. JSON is always
written first. Test data survives SQLite issues.

### 3. Reviewer Isolation (3-Layer)
`acceptance-test-reviewer` is the integrity boundary:
- `allowed-tools: [Read]` only (hard on Claude Code; advisory on others)
- Evidence-only dispatch — no shared executor context
- Separate subagent invocation

### 4. Fixed-SQL Oracle (No LLM-Generated SQL)
The `test-oracle` maps questions to 12 named parameterized queries by
keyword matching. Every query is auditable by code review.

### 5. Project-Local Storage
No home-global store. A project's test history travels with its code.

### 6. Public Contract = Events + Manifest Schema
Consumers subscribe to bus events and read the evidence manifest. They do
not read SQLite or agent bodies directly. This keeps wicked-testing free
to refactor internals without breaking downstream.

---

## Documentation Map

| Doc                                  | Audience                        |
|--------------------------------------|---------------------------------|
| [README.md](README.md)               | first read; quickstart          |
| ARCHITECTURE.md (this file)          | library maintainers, reviewers  |
| [docs/INTEGRATION.md](docs/INTEGRATION.md) | consumers of the library  |
| [docs/EVIDENCE.md](docs/EVIDENCE.md) | consumers reading manifests     |
| [docs/NAMESPACE.md](docs/NAMESPACE.md) | anyone adding skills / agents |
| [docs/STANDALONE.md](docs/STANDALONE.md) | users without wicked-garden |
| [docs/WICKED-GARDEN.md](docs/WICKED-GARDEN.md) | wicked-garden users   |
| [HOW-IT-WORKS.md](HOW-IT-WORKS.md)   | internal walkthrough            |
| [SCENARIO-FORMAT.md](SCENARIO-FORMAT.md) | scenario authors            |
| [DATA-DOMAIN.md](DATA-DOMAIN.md)     | schema reference (internal)     |
