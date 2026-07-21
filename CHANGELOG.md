# Changelog

All notable changes to `wicked-testing`. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/).

## [Unreleased]

### Fixed
- **`doctor` schema version check no longer false-positives on migrated databases.** `install.mjs` had a hardcoded `const codeVer = 1` that caused `doctor` to report "DB v2 is newer than code v1" (and "DB v3 is newer than code v1") on any database that had been migrated to schema version 2 or 3. Fixed by exporting `SCHEMA_VERSION` from `lib/domain-store.mjs` and importing it dynamically in `install.mjs` — the two values can no longer drift. The `scenarios/test-runner.md` scenario assertion `A4` and Step 3 expected query count were also updated to reflect the current state (`SCHEMA_VERSION = 3`, 13 named oracle queries).

### Changed
- **Evidence bus events reconciled onto the 4-segment `wicked.<domain>.<noun>.<verb>` catalog.** The divergent 3-segment emits are renamed:
  - `wicked.evidence.captured` → **`wicked.test.evidence.captured`** (both emit sites: the verdict path in `lib/bus-emit.mjs` and the manifest path in `skills/acceptance-testing/SKILL.md`). The two sites now share a **union payload** — common `{ project_id, run_id, evidence_path, wicked_testing_version }` plus optional `{ verdict_id, vault_payload_sha, artifact_count }`, each `null` when the emitting site lacks it — so one subscriber schema serves both.
  - `wicked-vault record`'s emit is split out to its own verb **`wicked.test.evidence.recorded`** (was `wicked.evidence.captured`), because its payload is a single recorded envelope, not a run's aggregated artifacts.
  - Sibling drift fixed: `wicked.scenario.authored` → **`wicked.test.scenario.authored`** and `wicked.testrun.started` → **`wicked.test.run.started`**.

  **Breaking for any subscriber filtering on the old 3-segment names.** Known consumers are unaffected — per `docs/INTEGRATION.md` § 4, the only documented read surface is `wicked.test.verdict.created` (unchanged). Update filters to the new names.

## [0.9.0] — 2026-07-12

### Changed
- **Test-lifecycle bus event names aligned to the `wicked-bus` SPEC map** (`wicked-bus/reqs/SPEC.md`, `wicked.test.<noun>.<past-verb>`). Renamed the three emitted types in `lib/bus-emit.mjs`:
  - `wicked.verdict.recorded` → `wicked.test.verdict.created`
  - `wicked.testrun.finished` → `wicked.test.run.completed`
  - `wicked.teststrategy.authored` → `wicked.test.strategy.generated`

  Payloads are unchanged. `wicked.testrun.started`, `wicked.scenario.authored`, `wicked.evidence.captured`, and `wicked.contract.published` are unchanged. The QE **acceptance** gate events (`wicked.qe.gate.passed/failed/conditional`, `wicked.qe.deploy.completed`) are a distinct gate and are **not** renamed. **Breaking for bus subscribers** — update filters to the new names.

### Fixed
- **OpenCode skills now actually load.** `install.mjs` copied skills to `~/.config/opencode/skills/`, but OpenCode only loads skills declared in `opencode.jsonc`'s `skills.paths` (or scanned under `~/.claude`/`~/.agents`) — so they installed invisible. The installer now registers the skills dir in `skills.paths` (JSONC-comment-safe, idempotent). Pi is unaffected (it auto-scans `~/.pi/agent/skills/`).

## [0.8.0] — 2026-07-12

### Changed
- **Converted the plugin to skills-only.** The 40 specialist agents and 7 commands are now **48 skills** — 40 `context: fork` specialists routed by 8 Tier-1 workflow skills. The `agents/` and `commands/` directories are removed, and `install.mjs` purges any left behind from prior installs. Dispatch names are unchanged (`wicked-testing:<name>`), so downstream consumers are unaffected.

### Added
- **`wicked-qe gate` CLI** (`bin/wicked-qe.mjs`, `lib/gate.mjs`) — standalone command for recording QE gate verdicts from agent scripts and CI pipelines. Validates inputs, writes to the domain store, emits `wicked.qe.gate.passed`, `wicked.qe.gate.failed`, or `wicked.qe.gate.conditional` bus events with DEC-00010 idempotency keys (`qe:gate.result:{projectId}:{sha256(runId)[0:16]}:0`). On PASS also emits `wicked.qe.deploy.completed`. Exit codes: 0 PASS / 1 FAIL / 2 CONDITIONAL / 3 SYSTEM_ERROR.
  ```bash
  wicked-qe gate --project-id myproject --run-id sprint-42 --verdict PASS --verdict-summary "201/201 tests pass"
  ```
- **`--dry-run` flag for `wicked-qe gate`** — validate and print JSON without store writes or bus emissions.

### Fixed
- **`CONDITIONAL` is now a legal verdict value (latent contract bug).** Four
  Tier-2 agents (`release-readiness`, `security`, `ai-feature`,
  `test-code-quality`) already emit `CONDITIONAL`, but it was absent from the
  manifest verdict enum (`schemas/evidence.json`, `lib/manifest.mjs`
  `validateShape`) — so the first manifest built off such a run threw
  `invalid verdict.value 'CONDITIONAL'`. Added to the enum, the prejudicial-
  content matcher, `docs/EVIDENCE.md`, and the acceptance-skill
  `VERDICT_TO_STATUS` map (`CONDITIONAL → partial`). Migration `002` adds a
  `CHECK` constraint to `verdicts.verdict` covering the full enum, and
  `DomainStore.create()` now validates the verdict against the enum (the shared
  `VERDICT_VALUES` source of truth) *before* the dual-write — so an out-of-enum
  value fails loudly and atomically (throws `ERR_INVALID_VERDICT`, nothing
  written to either store) instead of silently diverging the canonical JSON
  from the SQLite index.

## [0.7.3] — 2026-07-07

### Added
- **wicked-vault absorbed**: vault CLI (`bin/wicked-vault.mjs`), 6 skills (`skills/wicked-vault/`), hash chain, verifier registry, and bus integration now ship as part of wicked-testing — no separate wicked-vault package needed
- Migration `003_vault_evidence_sha.sql`: nullable `vault_payload_sha` column on verdicts table with partial index
- Updated event names: `wicked.evidence.captured` (was `wicked.evidence.recorded`) and `wicked.contract.published` (was `wicked.contract.declared`)
- Bus provider registration in `install.mjs` — vault events route correctly when wicked-bus is present
- 10 new unit tests in `tests/unit/bus-emit.test.mjs` covering dual-event path and vault record integration

### Changed
- `bus-emit.mjs`: `verdicts.create` returns `[wicked.verdict.recorded, wicked.evidence.captured]` array when `vault_payload_sha` is present
- `domain-store.mjs`: SCHEMA_VERSION 2→3; verdicts schema extended with `vault_payload_sha`

## [0.7.2] — 2026-07-07

### Fixed
- Skill name separator changed from colon to dash across all 47 skills (`wicked-testing-X` not `wicked-testing:X`) — colons are rejected by CLIs outside Claude Code
- `validate.mjs` updated to enforce dash format and updated `subagent_type` prefix check

---

## [0.7.1] — 2026-07-07

### Changed
- **`plugin.json` skills list removed** — Claude Code now auto-scans `skills/`
  directory directly. All 47 skills are discovered automatically; the previous
  explicit 7-entry list is no longer needed and was a maintenance liability.
- `sync-plugin-version.mjs` — comment updated to reflect auto-scan behaviour.

## [0.7.0] — 2026-07-06

**Skills-only architecture.** Everything is now a skill — agents and commands
are fully replaced. All 47 skills carry `context: fork` for cross-CLI isolation.
Lifecycle hooks now fire on all 8 supported CLIs.

### Changed
- **Skills-only distribution.** `agents/` and `commands/` are no longer
  installed. `install.mjs` distributes all 47 skills by scanning `skills/`
  directly. `plugin.json` registers only the 7 Tier-1 user-invokeable
  orchestrators; Tier-2 specialists are auto-discovered by the host CLI.
- **`context: fork` on all 47 skills** — the isolation boundary that makes
  skills behave like subagents in every supported CLI.
- **`allowed-tools` is advisory, not hard-enforcement** — isolation comes from
  the `context: fork` boundary, not from tool restriction. All skills updated.
- **All 40 Tier-2 specialist skills rewritten to minimal playbooks** (40–80 lines).
  Removed role-assignment framing, tool command sequences, reference tables,
  and "Non-negotiable rules" sections. Skills now read as neutral process docs.

### Added
- **SessionStart + SubagentStop hooks** on all 6 JSON-hook CLIs (Claude Code,
  Antigravity, Codex, Cursor, Kiro, Copilot). `session-start.mjs` shows QE
  project status at session open; `subagent-verdict.mjs` surfaces reviewer
  verdict when evidence landed in the last 60 seconds.
- **TypeScript plugins for OpenCode and Pi.** `hooks/opencode-plugin.ts`
  (`session.created` → session-start, `session.idle` → claim-nudge + verdict)
  and `hooks/pi-extension.ts` (`session_start` → session-start, `agent_end` →
  claim-nudge + verdict). Both are installed to the CLI's plugin/extensions dir
  alongside the hook scripts they delegate to. Loaded via Bun (opencode) and
  jiti (pi) — no compilation step.
- **`wicked-qe gate` CLI** (`bin/wicked-qe.mjs`, `lib/gate.mjs`) — standalone
  command for recording QE gate verdicts from agent scripts and CI pipelines.
  Emits `wicked.qe.gate.passed/failed/conditional` bus events. Exit codes:
  0 PASS / 1 FAIL / 2 CONDITIONAL / 3 SYSTEM_ERROR. `--dry-run` flag available.
- **Equivalence / baseline-match as a first-class verdict facet.** Optional
  `verdict.equivalence` block in the evidence schema (manifest `1.0.0 → 1.1.0`);
  `EQUIVALENT_TO_BASELINE` reviewer operator; `baseline_matches_for_scenario`
  oracle query. Backward-compatible — existing rows and manifests unaffected.
- **Versioned migration `002`** — adds `CHECK` constraint on `verdicts.verdict`
  and `equivalence_json` column. `SCHEMA_VERSION` bumped `1 → 2`.

### Fixed
- **`CONDITIONAL` verdict was missing from the manifest enum (latent contract
  bug).** Four Tier-2 skills already emit `CONDITIONAL` but it was absent from
  `schemas/evidence.json` and `lib/manifest.mjs` `validateShape`. Now added to
  the enum, the prejudicial-content matcher, `docs/EVIDENCE.md`, and
  `VERDICT_TO_STATUS` map. `DomainStore.create()` validates verdict before the
  dual-write — out-of-enum values throw `ERR_INVALID_VERDICT` atomically.
- **Requirements section in README** listed Copilot as removed; it is supported.
  Updated to list all 8 CLIs.
- **`sync-plugin-version.mjs`** no longer drifts on agents/commands (legacy dirs)
  or Tier-2 skills (intentionally absent from `plugin.json`). Now version-only.

## [0.4.1] — 2026-06-10

Docs-truth patch — no behavior change.

### Fixed
- README still claimed **41** specialist agents and **16** Tier-1 agents after the
  0.4.0 roster trim (41 → 40, `continuous-quality-monitor` folded into
  `code-analyzer`); now reads **40** / **15** everywhere.
- README listed **Copilot CLI** as a supported platform; Copilot support was
  removed in 0.4.0 pending a verified integration point
  ([#59](https://github.com/mikeparcewski/wicked-testing/issues/59)). Supported
  CLIs are Claude Code, Gemini CLI, Cursor, Codex, and Kiro. The stale `copilot`
  npm keyword is dropped too.

## [0.4.0] — 2026-06-10

**Breaking: command surface cut 15 → 7.** wicked-testing now exposes exactly the
five-core it always advertised — `plan` / `authoring` / `execution` / `review` /
`insight` — plus `acceptance` (the 3-agent gate) and `setup`. Agents stay
dispatch-reachable from the surviving skills, are now self-describing via `tier:`
metadata, and the roster is trimmed 41 → 40.

### Removed (breaking)
- `stats`, `report`, `oracle` → ask **`insight`** (same fixed-SQL oracle underneath).
- `tasks` → removed; task rows stay queryable via `insight`, task mutation via the `DomainStore` API (`lib/domain-store.mjs`).
- `scenarios`, `automate` → ask **`authoring`**.
- `run` → ask **`execution`**.
- `ci-bootstrap` → **capability removed, not relocated.** Its CI provider-detection and workflow-template auto-generation are dropped. The templates remain in `templates/ci/` for manual use (see `docs/CI.md`); portable, re-derived CI gating is wicked-garden's `compile`. `execution` owns only the lightweight "wire CI to run these tests" intent.

### Changed
- Skills consolidated 12 → 7 (`scenario-authoring` + `browser-automation` → `authoring`; `test-strategy` → `plan`; `test-oracle` skill → `insight`, the test-oracle *agent* is unchanged; `test-runner` → `execution` + `setup`).
- Browser testing standards (console-error = automatic FAIL, headless by default, no fixed `sleep`) moved from the retired `browser-automation` skill into the `e2e-orchestrator` agent.
- **Agent tier is now single-source metadata.** `tier:` frontmatter on each agent is the sole source of truth; `validate.mjs` **fails the build** if it disagrees with `plugin.json` or the `NAMESPACE.md`/`INTEGRATION.md §3` tier tables — eliminating the recurring drift across the previously-duplicated copies. `plugin.json` `agents[]` now carries `tier`.
- **Roster trimmed 41 → 40.** Cut `continuous-quality-monitor` (advisory-only tier-1, base-agent-replaceable), folding its build-phase signals into `code-analyzer` (which keeps its post-code static-quality niche).

### Added
- **Opt-in claim-boundary hook** (off by default). Set `"claim_nudge": true` in `.wicked-testing/config.json` to be nudged to run `acceptance` when a turn claims "tests pass" with no acceptance verdict on record. Non-blocking (one line, ignorable). Auto-registers under a marketplace/plugin install; loose-skill installs (`npx wicked-testing install`) require plugin-mode for the hook to fire — a follow-up will add loose-path registration.
- **`npx wicked-testing contract --json`** subcommand emits the published tier contract; **`wicked.contract.published`** bus event announces contract changes (a non-load-bearing refresh hint — consumers read the contract, never a hardcoded mirror).
- **better-sqlite3 ABI-mismatch nudge.** On a Node ABI mismatch the store degrades to JSON-only; the degradation message and `doctor` now tell you to run `npm rebuild better-sqlite3` (it failed silently before).

### Unchanged
- Ledger schema, evidence format, and scenario file format are untouched — this is a surface cut, not a data migration. Existing scenarios, runs, and verdicts keep working.

## [0.3.3] — 2026-04-21

Install-path detection fix. Prior versions hardcoded `~/.claude` (and siblings) as the install target and ignored both `$CLAUDE_CONFIG_DIR` and common alt-config layouts. Users running Claude Code with its config redirected — via `CLAUDE_CONFIG_DIR`, a shared-home setup at `~/alt-configs/.claude`, or an XDG-style `~/.config/claude` — would see `wicked-testing install` complete successfully while silently writing into a path Claude Code never reads. Skills loaded as zero, doctor reported green, users lost hours.

### Fixed

- **`install.mjs` now honors `$CLAUDE_CONFIG_DIR`.** When set, it is authoritative — the installer writes only to that path (trusted, skipping the identity-marker check so first-run setups where the dir exists but is empty still work). This matches Claude Code's own resolution behavior.
- **Alt-config layouts are now probed automatically.** When `CLAUDE_CONFIG_DIR` is unset, the installer probes `~/.claude`, `~/alt-configs/.claude`, and `~/.config/claude`, installing into each that carries Claude identity markers (`settings.json` / `plugins/` / `projects/`). Multi-config setups stay in sync without manual `--path` juggling.
- **`--path <dir>` (space-separated) now works.** Previously only `--path=<dir>` was honored; the space form was silently accepted and then dropped, causing installs to fall through to default detection. Fix applies to every flag with a value (`--cli`, `--require`, `--assume-cli`, etc.).

### Added

- **`doctor` surfaces `CLAUDE_CONFIG_DIR` state explicitly.** Shows which path was picked up, from which source (`env:CLAUDE_CONFIG_DIR` / `default` / `alt-configs` / `xdg`), and warns when the env var points at a nonexistent dir or one without Claude identity markers.
- **`doctor --json` now includes `claude_config_dir` and `detected_targets`** (full `{name, root, source}` records). The legacy `detected_clis` string[] shape is preserved for back-compat.
- **Help text documents the new behavior** including a `CLAUDE_CONFIG_DIR=~/alt-configs/.claude npx wicked-testing install` example.

### Why this matters

Parallel patches are coming to `wicked-brain` (0.12.1) and `wicked-bus` (1.1.1) for the same bug — all three packages use the same install template and inherited the same flaw.

## [0.3.2] — 2026-04-21

Real fix for the "skills aren't loading in Claude Code" symptom. The v0.3.1 release misdiagnosed the cause as missing plugin registration and shipped a `marketplace.json` workaround. Turned out to be simpler: **6 of 12 `skills/*/SKILL.md` files had unprefixed `name:` frontmatter** (`name: test-runner` instead of `name: wicked-testing:test-runner`). Claude Code's skill resolver silently rejects skills whose frontmatter namespace doesn't match the plugin — when enough skills in a batch are broken, the whole plugin goes dark.

### Fixed

- **SKILL.md frontmatter `name:`** normalized to `wicked-testing:<name>` across all 12 Tier-1 + auxiliary skills. Previously `acceptance-testing`, `browser-automation`, `scenario-authoring`, `test-oracle`, `test-runner`, `test-strategy` had bare names and were being dropped. Now every SKILL.md's `name:` matches the Claude Code plugin-namespace convention (same pattern `wicked-brain` has always used — `wicked-brain:memory`, `wicked-brain:search`, etc.).
- **`scripts/dev/validate.mjs`** now enforces `name == 'wicked-testing:<dir>'` on every skill. A PR that re-introduces the bare-name form fails `npm test` immediately. Prevents regression of the whole v0.3.1 issue category.

### Changed

- **README install section simplified.** `npx wicked-testing install` is the preferred path on every CLI including Claude Code — skills get dropped into `~/.claude/skills/wicked-testing-<name>/` and Claude Code picks them up directly (same as `wicked-brain-*/`). The `claude plugins marketplace add` path still works and remains documented as an optional alternative for users who prefer the plugin-system install flow. The v0.3.1 framing of "Claude Code REQUIRES plugin registration" was wrong.
- **`install.mjs` post-install Claude Code guidance removed.** With the frontmatter fix, `npx wicked-testing install` works correctly for Claude Code; the "also run `claude plugins install`" nudge would now be misleading. The `.claude-plugin/marketplace.json` file from v0.3.1 stays on disk for users who prefer that path.

### Kept from v0.3.1

- `.claude-plugin/marketplace.json` — harmless and provides an alternative install path for plugin-system enthusiasts.
- Legacy bare-name skill-dir migration in `install.mjs` — still needed to clean up the pre-0.3 layout on upgrade.

### Debug trail

The actual bug was caught by listing every dir under `~/.claude/skills/` with its frontmatter `name:` side-by-side, against `~/.claude/skills/wicked-brain-*/`. Same on-disk location, identical structure — but 6 of 12 wicked-testing frontmatter names were `<dir>` instead of `wicked-testing:<dir>`. wicked-brain was 23/23 correct. Claude Code's resolver was doing exactly what any sane resolver would do — reject skills whose frontmatter doesn't declare the right namespace.

## [0.3.1] — 2026-04-21

Claude Code install-path fix + stale-layout migration. No API changes; this is strictly about making the plugin actually load on Claude Code.

### Added

- **`.claude-plugin/marketplace.json`** — wicked-testing is now a proper Claude Code marketplace. Users can register it via:

  ```bash
  claude plugins marketplace add mikeparcewski/wicked-testing
  claude plugins install wicked-testing
  ```

- **`install.mjs` migrates the pre-0.3 skill layout.** Older installs dropped skills under `~/.claude/skills/{acceptance-testing,browser-automation,scenario-authoring,test-oracle,test-runner,test-strategy}/` — unprefixed, orphaned after 0.3 switched to the `wicked-testing-<name>/` layout. `install.mjs` now detects those bare-name dirs (paranoid signature check — SKILL.md frontmatter `name:` must match the dir name AND the body must reference wicked-testing) and removes them on install. Same migration runs on uninstall. Collision-safe: generic names like `test-runner` that belong to other tools are left alone.

- **`install.mjs` emits Claude Code–specific guidance.** When Claude Code is detected and wicked-testing isn't yet registered via `claude plugins`, the installer prints a prominent note pointing the user at the plugin-system install path. Silent when the `claude` binary isn't on PATH or the plugin is already registered.

### Fixed

- **README's Claude Code install command.** Was `claude plugins add mikeparcewski/wicked-testing` (not a valid command); now `claude plugins marketplace add mikeparcewski/wicked-testing` followed by `claude plugins install wicked-testing`.
- **Install section rewritten** to explain the two install paths (plugin-system for Claude Code vs file-copy for Gemini / Codex / Cursor / Kiro) and why — Claude Code's skill resolver only surfaces skills from registered plugins, so the file-copy install leaves skills on disk but unloaded on Claude Code.

### Background

Surfaced during the v0.3.0 dogfood — `wicked-testing install` ran cleanly, doctor reported green, but Claude Code's `/reload-plugins` showed none of the 12 registered skills. Investigation found no `wicked-testing` entry in `~/.claude/plugins/installed_plugins.json`: the npm install path never registered the package with Claude Code's plugin system. The 6 bare-name skill dirs from April 11 were also on disk, compounding the confusion (generic `test-runner` / `test-strategy` names looked like they could be from any tool).

## [0.3.0] — 2026-04-21

First release after the end-to-end audit (see [#28](https://github.com/mikeparcewski/wicked-testing/issues/28)). Seven PRs landed 48 of 49 audit findings; this release cuts a version from the resulting main branch. No breaking API changes for consumers that followed the public contract documented in `docs/INTEGRATION.md` (the reshape of drifted claims is in doc surface only).

### Added

- **New Tier-1 skill: `wicked-testing:update`** — checks for and installs updates to the published npm package, refreshes skills / agents / commands across every detected AI CLI, verifies the upgrade landed.
- **9 new Tier-2 specialists** (roster 16 → 25):
  - `test-impact-analyzer` — diff → ranked affected scenarios
  - `release-readiness-engineer` — aggregates verdicts + flakes + risk + SLO → GO/CONDITIONAL/NO-GO
  - `security-test-engineer` — SAST/DAST/secrets/authz with OWASP ASVS traceability
  - `ai-feature-test-engineer` — prompt-injection, hallucination, judge ≠ SUT isolation
  - `iac-test-engineer` — terraform/checkov/opa/kyverno/helm/cfn-guard
  - `compliance-test-engineer` — SOC2/HIPAA/GDPR/PCI control mapping
  - `snapshot-hygiene-auditor` — snapshot rot/over-broad/rubber-stamp detection
  - `test-code-quality-auditor` — assertion-free, tautological, swallowing tests etc.
  - `incident-to-scenario-synthesizer` — stack trace → reproducible scenario
- **Top-5 Tier-2 specialists rewritten** with concrete tool invocations, DomainStore integration, evidence outputs, failure-mode taxonomies, auto-invoke examples: `a11y-test-engineer`, `chaos-test-engineer`, `flaky-test-hunter`, `mutation-test-engineer`, `visual-regression-engineer`.
- **Bus-event emission** via `lib/bus-emit.mjs` (previously a no-op stub). Six-event public catalog now fires at the right DomainStore CRUD sites: `wicked.scenario.authored`, `wicked.teststrategy.authored`, `wicked.testrun.started`, `wicked.testrun.finished`, `wicked.verdict.recorded`, `wicked.evidence.captured`.
- **Evidence manifest producer** `lib/manifest.mjs` — writes contract-compliant `.wicked-testing/evidence/<run-id>/manifest.json` with sha256-hashed artifacts, inline shape validation.
- **Context validator** `lib/context-md-validator.mjs` — pre-dispatch scrub of prejudicial patterns in reviewer `context.md` (verdict assignments, run_id references, historical counts, executor chain-of-thought leaks).
- **Node-enforced step timeout** `lib/exec-with-timeout.mjs` — replaces the GNU `timeout` shell dependency (absent on stock macOS).
- **Migration runner** `lib/migrate.mjs` — versioned, self-bootstrapping, per-file transactioned. Replaces the duplicated `lib/schema.sql` path.
- **New CLI subcommand** `check --require=<spec>` — consumer-facing semver compatibility check (=, ^, ~, >=, >, <=, <; honors strict SemVer for 0.x.y).
- **New install flags** `--assume-cli=<name>` (override identity-marker detection) and `--skip-self-test` (documented in README).
- **Install-time isolation-tier warning** — per-target advisory for non-Claude hosts where `allowed-tools` is prompt-enforced, not host-enforced.
- **Doctor diagnostic framework** — 8 structured checks with colored badges and remediation hints: node version, CLI detection, `better-sqlite3`, per-target install integrity, schema version, `plugin.json` drift.
- **Eval runner infrastructure** — `evals:run`, `evals:check-all`, 3 new assertion kinds (`not-contains-text`, `ledger-matches-manifest`, `dispatches-agent`), tighter `produces-artifact` (`min_bytes`, `contains_regex`), model-pin fields (`model_pin`, `temperature`, `seed`).
- **CI gate for evals** — `.github/workflows/evals.yml` runs `check-all` on every PR touching `evals/**` or the runner.
- **CI integration templates** — GitHub Actions, GitLab, Jenkins, Buildkite; new `commands/ci-bootstrap.md` detects provider and emits the right template; `docs/CI.md` chapter covering exit-code contract, artifact publishing, PR-comment summary, secrets, headless mode, caching.
- **Eval coverage** grew 32 → 53 sets: 11 new skill-level eval sets (`evals/skills/**`), pipeline end-to-end eval, reviewer isolation adversarial cases, oracle per-query routing + obfuscation cases, writer/executor negative cases, tightened a11y/load-perf/strategist/flaky assertions.

### Fixed

- `--version` / `-v` / `--help` / `-h` flags now route to the matching subcommand (previously silently ran `install`). Session-start consumer probes — including wicked-garden's — now parse the bare semver.
- Evidence path unified at `.wicked-testing/evidence/<run-id>/` across every skill / command / agent (previously drifted between `runs/` and `evidence/`).
- RUN_ID uses the DomainStore-assigned UUID; no more 1-second-granularity collisions between parallel pipelines.
- `test-designer` constrained to `Read, Write, Bash, Grep, Glob` (stripped `Agent`, `Skill`, `Edit`); body marked as dev-loop fast path with explicit self-grading warning. Default verdict dispatch in `skills/execution/SKILL.md` now routes to the 3-agent pipeline.
- Scenario body is no longer inlined into the writer's prompt — passes path only; writer reads with its own `Read` tool and treats contents as data, not instructions.
- DomainStore SQL interpolation of `${source}` / `${table}` now validates against the TABLES allowlist — `ERR_INVALID_SOURCE` on anything unexpected.
- DomainStore is now a real singleton per resolved root.
- Stale `.tmp.<n>` files get swept on init; runs stuck in `'running'` > 1h get reclaimed to `errored` with `wicked.testrun.finished` emission.
- `atomicWriteJson` failures now wrap with `ERR_JSON_WRITE_FAILED` (distinct from SQLite failures).
- `buildOracleQuery` param order fixed — no more double-push of `since`/`project` values for templated queries like `runs_by_status`.
- `rebuildIndex` now uses the migration runner (latent `schema.sql` reference from Wave 4 was broken), wraps bulk reload in one outer transaction to keep WAL syncs O(1), and runs with `PRAGMA foreign_keys = OFF` + a `foreign_key_check` audit at the end so reloads don't blow up on drop/insert order.
- 20 Unix-only shell constructs across 9 files replaced with portable equivalents (`${TMPDIR:-${TEMP:-/tmp}}`, `python3 || python` fallback, Node exec-with-timeout). `scripts/dev/validate.mjs` gained a `checkCrossPlatform()` gate to prevent regressions.
- `plugin.json` now auto-syncs from disk (`skills`, `agents`, `commands` arrays + version) on `prepublishOnly` and `npm test` — the historical 11-on-disk / 5-registered / 14-on-disk / 10-registered drift is gone.
- Doctor `plugin.json` drift check added.
- Docs reconciled: README command table complete (14 commands listed); `--json` claim corrected to name the two exceptions; Tier-2 table expanded; install section documents new flags; `docs/NAMESPACE.md` reversed stale "retired" notice and adds a section on private agent-frontmatter fields.
- `HOW-IT-WORKS.md` Step 5 write order fixed; `DATA-DOMAIN.md` clarifies the 7-table count includes `schema_migrations` and notes `fdatasync` is best-effort.

### Removed

- `copilot` CLI target (was aimed at `~/.github/skills` — speculative path that collided with GitHub dotfiles; no verified Copilot integration point exists).
- `lib/schema.sql` — duplicate of `lib/migrations/001_initial.sql`; migrations/ is now the single source of truth.
- Three invented event names from README (`wicked.testrun.completed`, `wicked.scenario.registered`, `wicked.oracle.queried`) — reconciled to the canonical names in `docs/INTEGRATION.md`.

### Deferred

- 10 pre-Wave-6 Tier-2 specialists still carry generic prose bodies (integration, ui-component, e2e-orchestrator, fuzz-property, localization, data-quality, observability, test-data-manager, exploratory-tester, coverage-archaeologist). Tracked in [#57](https://github.com/mikeparcewski/wicked-testing/issues/57); the Wave-6 pattern and eval harness are in place whenever time allows.
- `allowed-tools` YAML-list migration across all agents, tier-2 `<example>` block additions, per-specialist tool-grant audit, `evals-diff` utility, rubric assertion kind — all queued on the P2 tracker for ongoing maintenance.

## [0.2.0] — 2026-04-20

Brain / bus integration for the 3-agent pipeline. (See [commit `cd748a5`](https://github.com/mikeparcewski/wicked-testing/commit/cd748a5).)

## [0.1.2] — 2026-04-20

Repo made public; provenance publishing unblocked.

## [0.1.1] — 2026-04-20

`package.json` `url` field fix.

## [0.1.0] — 2026-04-11

Initial release.
