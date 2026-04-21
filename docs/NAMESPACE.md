# Namespace

wicked-testing uses a single, flat namespace: **`wicked-testing:*`**.

The `qe:` prefix from earlier drafts (and from wicked-garden's embedded QE
domain) is **retired**. It persists only as a short-lived alias layer in
wicked-garden for one minor version.

---

## Skills

| Name                       | Command                     |
|----------------------------|-----------------------------|
| `wicked-testing:plan`      | `/wicked-testing:plan`      |
| `wicked-testing:authoring` | `/wicked-testing:authoring` |
| `wicked-testing:execution` | `/wicked-testing:execution` |
| `wicked-testing:review`    | `/wicked-testing:review`    |
| `wicked-testing:insight`   | `/wicked-testing:insight`   |

These five are the **Tier-1 public surface**. Consumers (wicked-garden, other
plugins) reference them by these exact names. Renames require a major version.

---

## Agents (Tier-1 — stable `subagent_type` dispatch)

| `subagent_type`                                | Purpose                                        |
|------------------------------------------------|------------------------------------------------|
| `wicked-testing:test-strategist`               | Generate scenarios + coverage strategy         |
| `wicked-testing:testability-reviewer`          | Design-phase testability review                |
| `wicked-testing:requirements-quality-analyst`  | AC quality at clarify phase                    |
| `wicked-testing:risk-assessor`                 | Identify failure modes + risk matrix           |
| `wicked-testing:test-designer`                 | Plan → execute → verdict in one loop           |
| `wicked-testing:test-automation-engineer`      | Generate test code + configure runners         |
| `wicked-testing:acceptance-test-writer`        | Evidence-gated test-plan authoring             |
| `wicked-testing:scenario-executor`             | Execute a scenario file end-to-end             |
| `wicked-testing:acceptance-test-executor`      | Run plan, capture artifacts, no judgment       |
| `wicked-testing:contract-testing-engineer`     | Consumer-driven / OpenAPI contracts            |
| `wicked-testing:acceptance-test-reviewer`      | Independent verdict on captured evidence       |
| `wicked-testing:semantic-reviewer`             | Spec-to-code alignment check                   |
| `wicked-testing:code-analyzer`                 | Static quality / testability metrics           |
| `wicked-testing:production-quality-engineer`   | Post-deploy quality monitoring                 |
| `wicked-testing:continuous-quality-monitor`    | Build-phase quality signals                    |
| `wicked-testing:test-oracle`                   | Fixed-SQL oracle queries over the ledger       |

---

## Agents (Tier-2 — internal specialists)

Tier-2 agents are dispatched **only** by Tier-1 skills. They are not part of
the public contract. Their names and count can change across minor versions.

Examples (names illustrative — final roster lives in `agents/` tree):

`integration-test-engineer`, `ui-component-test-engineer`, `e2e-orchestrator`,
`visual-regression-engineer`, `a11y-test-engineer`, `load-performance-engineer`,
`chaos-test-engineer`, `fuzz-property-engineer`, `mutation-test-engineer`,
`localization-test-engineer`, `data-quality-tester`,
`observability-test-engineer`, `flaky-test-hunter`, `test-data-manager`,
`exploratory-tester`, `coverage-archaeologist`.

Consumers **must not** reference these in gate-policy.json, specialist.json,
or anywhere else. If you need a Tier-2 capability publicly, open an issue to
promote it.

---

## Commands

Slash commands mirror the Tier-1 skills, plus operational commands:

| Command                       | Purpose                                        |
|-------------------------------|------------------------------------------------|
| `/wicked-testing:plan`        | Plan / strategy / risk / testability           |
| `/wicked-testing:authoring`   | Author scenarios + test code                   |
| `/wicked-testing:scenarios`   | Manage scenario files (list, show, archive)    |
| `/wicked-testing:automate`    | Generate runnable test code from a scenario    |
| `/wicked-testing:execution`   | Run scenarios, collect evidence                |
| `/wicked-testing:run`         | Execute a scenario (fast path via scenario-executor) |
| `/wicked-testing:acceptance`  | Full 3-agent pipeline (writer → executor → reviewer) |
| `/wicked-testing:review`      | Produce an independent verdict                 |
| `/wicked-testing:insight`     | Stats, reports, flaky / coverage signals       |
| `/wicked-testing:setup`       | First-run installation nudge / health check    |
| `/wicked-testing:oracle`      | Fixed-SQL questions over the ledger            |
| `/wicked-testing:tasks`       | Task tracking (quarantines, follow-ups)        |
| `/wicked-testing:stats`       | Quick summary stats                            |
| `/wicked-testing:report`      | Human-readable run report                      |
| `/wicked-testing:ci-bootstrap`| Detect CI provider + emit workflow template    |

All 14 commands are supported. The earlier plan to alias
`/wicked-testing:scenarios`, `/wicked-testing:automate`, `/wicked-testing:run`,
and `/wicked-testing:acceptance` under a "retired" notice was **reversed** —
those commands are first-class and documented in the README command table.

---

## Private agent-frontmatter fields

wicked-testing agents use four frontmatter keys that are **not** part of
the standard Claude Code agent schema. They are consumed by the plugin's
own dispatcher and documentation tooling. They are safe to leave on
non-Claude CLIs (unrecognized keys silently no-op):

| Field           | Type    | Purpose                                                               |
|-----------------|---------|-----------------------------------------------------------------------|
| `subagent_type` | string  | Canonical `wicked-testing:<name>` dispatch id. Used by skills to route Task() calls. |
| `effort`        | string  | Planner hint — `low` / `medium` / `high`. Advisory only; the dispatcher uses it for cost estimates. |
| `max-turns`     | integer | Upper bound on dispatcher iterations for this agent. Advisory; hosts that don't honor it ignore the field. |
| `color`         | string  | UI hint for hosts that colorize agent output. Standard Claude Code field. |

The wicked-testing `subagent_type` namespace is part of the public
contract for Tier-1 agents (see the table above). For Tier-2 specialists
it is internal and subject to change.

---

## Migration from `wicked-garden:qe:*`

| Old (wicked-garden 6.x)            | New (wicked-testing)              |
|------------------------------------|-----------------------------------|
| `wicked-garden:qe:qe`              | `/wicked-testing:review`          |
| `wicked-garden:qe:qe-plan`         | `/wicked-testing:plan`            |
| `wicked-garden:qe:scenarios`       | `/wicked-testing:authoring`       |
| `wicked-garden:qe:automate`        | `/wicked-testing:authoring`       |
| `wicked-garden:qe:run`             | `/wicked-testing:execution`       |
| `wicked-garden:qe:acceptance`      | `/wicked-testing:execution`       |
| `wicked-garden:qe:qe-review`       | `/wicked-testing:review`          |
| `wicked-garden:qe:report`          | `/wicked-testing:insight`         |
| `subagent_type: wicked-garden:qe:test-strategist` | `subagent_type: wicked-testing:test-strategist` |
| ... (all qe subagents map by 1:1 rename) | (drop the `qe:` segment)      |

wicked-garden keeps aliases for one minor version. After that, references to
`wicked-garden:qe:*` fail loud.

---

## Rules

1. New skills, agents, or commands MUST use the `wicked-testing:` prefix.
2. Tier-2 specialist names are internal; do not document them as part of a
   contract elsewhere.
3. `qe:` is dead. Do not resurrect it.
