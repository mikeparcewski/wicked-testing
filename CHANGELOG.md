# Changelog

All notable changes to `wicked-testing`. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/).

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
