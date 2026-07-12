# Namespace

wicked-testing uses a single, flat namespace: **`wicked-testing:*`**.

Everything in that namespace is a **skill**. There are no separate agent or
command component types — former agents are now forked skills
(`context: fork`), and former slash commands are folded into their
same-named workflow skills.

The `qe:` prefix from earlier drafts (and from wicked-garden's embedded QE
domain) is **retired**. It persists only as a short-lived alias layer in
wicked-garden for one minor version.

---

## Workflow skills (user-invokable entry points)

| Name                                | Invocation                          |
|-------------------------------------|-------------------------------------|
| `wicked-testing:plan`               | `/wicked-testing:plan`              |
| `wicked-testing:authoring`          | `/wicked-testing:authoring`         |
| `wicked-testing:execution`          | `/wicked-testing:execution`         |
| `wicked-testing:acceptance-testing` | `/wicked-testing:acceptance`        |
| `wicked-testing:review`             | `/wicked-testing:review`            |
| `wicked-testing:insight`            | `/wicked-testing:insight`           |
| `wicked-testing:setup`              | `/wicked-testing:setup`             |
| `wicked-testing:update`             | `/wicked-testing:update`            |

`plan`, `authoring`, `execution`, `review`, and `insight` are the **Tier-1
public surface**. Consumers (wicked-garden, other plugins) reference them by
these exact names. Renames require a major version. `acceptance-testing`,
`setup`, and `update` are operational entry points.

The old `/wicked-testing:<command>` slash strings (including
`/wicked-testing:acceptance`) are kept as triggers in each skill's
`Use when:` description, so existing muscle memory and docs keep working.

---

## Tier-1 forked skills (stable dispatch names)

These 15 skills run in isolated forked contexts (`context: fork`) and are
dispatched by the workflow skills. The dispatch names are identical to the
former agent `subagent_type` values, so consumer contracts are unchanged.

| Dispatch name                                  | Purpose                                        |
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
| `wicked-testing:test-oracle`                   | Fixed-SQL oracle queries over the ledger       |

---

## Tier-2 forked skills (internal specialists)

The 25 Tier-2 specialist skills are dispatched **only** by the workflow
skills, each into its own forked context. They are not part of the public
contract. Their names and count can change across minor versions.

Examples (names illustrative — the full roster lives in the `skills/` tree,
one directory per skill):

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

## Private skill-frontmatter fields

wicked-testing skills use frontmatter keys beyond the standard Claude Code
skill schema. They are consumed by the plugin's own dispatch tables and
documentation tooling, and are safe to leave on non-Claude CLIs
(unrecognized keys silently no-op):

| Field           | Type    | Purpose                                                               |
|-----------------|---------|-----------------------------------------------------------------------|
| `context`       | string  | `fork` marks a skill that must be dispatched into an isolated context with no shared conversation history. All 40 specialist skills carry it; workflow skills do not. |
| `tier`          | integer | `1` = stable public dispatch surface, `2` = internal specialist. Workflow skills carry no tier. |
| `effort`        | string  | Planner hint — `low` / `medium` / `high`. Advisory only; the dispatcher uses it for cost estimates. |
| `max-turns`     | integer | Upper bound on dispatcher iterations for this skill. Advisory; hosts that don't honor it ignore the field. |
| `color`         | string  | UI hint for hosts that colorize output.                               |

The **dispatch id** is the colon form `wicked-testing:<name>` — the tables
above list it, `.claude-plugin/plugin.json` emits it as each skill's
`command` and `subagent_type` contract entry, and Claude Code resolves it as
the `plugin:skill` invocation. The former `subagent_type` frontmatter field is
gone — its value was always identical to this dispatch id, so nothing changed
for consumers. For Tier-1 skills the dispatch id is part of the public
contract (see the table above); for Tier-2 specialists it is internal and
subject to change.

The skill's frontmatter `name:` field, by contrast, is the **dash-joined**
`wicked-testing-<name>` (e.g. `wicked-testing-test-strategist`). It is *not*
the dispatch id: it names the installed skill directory
(`{cli}/skills/wicked-testing-<name>/`) so every CLI — including the
non-Claude hosts that rewrite `:`→`-` in directory names — sees a matching
`name`/dir pair. The colon lives only where a host needs the `plugin:skill`
separator (plugin.json `command`) or where the published dispatch contract is
read.

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
| `subagent_type: wicked-garden:qe:test-strategist` | `wicked-testing:test-strategist` (skill dispatch name) |
| ... (all qe subagents map by 1:1 rename) | (drop the `qe:` segment)      |

wicked-garden keeps aliases for one minor version. After that, references to
`wicked-garden:qe:*` fail loud.

---

## Rules

1. New skills MUST be namespaced to wicked-testing: frontmatter `name:` =
   `wicked-testing-<dir>` (dash), dispatch id / plugin.json `command` =
   `wicked-testing:<dir>` (colon).
2. Tier-2 specialist names are internal; do not document them as part of a
   contract elsewhere.
3. `qe:` is dead. Do not resurrect it.
