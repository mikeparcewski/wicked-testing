# Namespace

wicked-testing uses a single, flat namespace: **`wicked-testing:*`**.

The `qe:` prefix from earlier drafts (and from wicked-garden's embedded QE
domain) is **retired**. It persists only as a short-lived alias layer in
wicked-garden for one minor version.

---

## Skills — Tier-1 (user-invokeable public surface)

| Name                                  | Slash invocation                        |
|---------------------------------------|-----------------------------------------|
| `wicked-testing:plan`                 | `/wicked-testing:plan`                  |
| `wicked-testing:authoring`            | `/wicked-testing:authoring`             |
| `wicked-testing:execution`            | `/wicked-testing:execution`             |
| `wicked-testing:review`               | `/wicked-testing:review`                |
| `wicked-testing:insight`              | `/wicked-testing:insight`               |
| `wicked-testing:acceptance-testing`   | `/wicked-testing:acceptance-testing`    |
| `wicked-testing:update`               | `/wicked-testing:update`                |

These seven are the **Tier-1 public surface**. Consumers (wicked-garden, other
plugins) reference them by these exact names. Renames require a major version.

---

## Skills — Tier-1 Internal (stable dispatch names)

| Skill name                                     | Purpose                                        |
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

## Skills — Tier-2 Internal (specialists)

Tier-2 skills are dispatched **only** by Tier-1 skills. They are not part of
the public contract. Their names and count can change across minor versions.

Examples (names illustrative — final roster lives in the `skills/` directory):

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

## Slash Commands

Slash command syntax invokes the matching installed skill. `/wicked-testing:X`
resolves to the `wicked-testing:X` skill in the host CLI's skills directory —
there is no separate commands distribution layer.

| Slash command                          | Skill invoked                            |
|----------------------------------------|------------------------------------------|
| `/wicked-testing:plan`                 | `wicked-testing:plan`                    |
| `/wicked-testing:authoring`            | `wicked-testing:authoring`               |
| `/wicked-testing:execution`            | `wicked-testing:execution`               |
| `/wicked-testing:acceptance-testing`   | `wicked-testing:acceptance-testing`      |
| `/wicked-testing:review`               | `wicked-testing:review`                  |
| `/wicked-testing:insight`              | `wicked-testing:insight`                 |
| `/wicked-testing:update`               | `wicked-testing:update`                  |

---

## Skill frontmatter fields

wicked-testing skills use these frontmatter keys. Standard Open Agent Skills
keys (`name`, `description`, `context`) are recognized by all supporting CLIs.
Advisory keys (`allowed-tools`, `effort`, `max-turns`) are hints only — CLIs
that don't recognize them silently ignore them.

| Field           | Type    | Purpose                                                               |
|-----------------|---------|-----------------------------------------------------------------------|
| `name`          | string  | Canonical `wicked-testing:<name>` dispatch id. Part of the public contract for Tier-1 skills. |
| `context`       | string  | `fork` — instructs supporting CLIs to run this skill in an isolated context. |
| `allowed-tools` | list    | Advisory tool hints. Not host-enforced; isolation relies on the `context: fork` boundary and dispatch pattern. |
| `effort`        | string  | Planner hint — `low` / `medium` / `high`. Advisory only. |
| `max-turns`     | integer | Advisor upper bound on dispatcher iterations. Hosts that don't honor it ignore the field. |
| `color`         | string  | UI hint for hosts that colorize skill output. |

The `name` field namespace is part of the public contract for Tier-1 skills
(see the table above). For Tier-2 specialists it is internal and subject to
change.

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
| `subagent_type: wicked-garden:qe:test-strategist` | `wicked-testing:test-strategist` skill         |
| ... (all qe subskills map by 1:1 rename)          | (drop the `qe:` segment)                        |

wicked-garden keeps aliases for one minor version. After that, references to
`wicked-garden:qe:*` fail loud.

---

## Rules

1. New skills MUST use the `wicked-testing:` prefix.
2. Tier-2 specialist names are internal; do not document them as part of a
   contract elsewhere.
3. `qe:` is dead. Do not resurrect it.
