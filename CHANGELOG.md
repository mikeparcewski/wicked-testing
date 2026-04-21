# Changelog

All notable changes to `wicked-testing`. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/).

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
