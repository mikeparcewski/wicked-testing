---
name: REQ-004-ways-of-working
title: wicked-testing — Ways of Working
status: draft
version: 0.1
date: 2026-07-21
author: mike.parcewski@gmail.com
review-required: true
---

# REQ-004 — Ways of Working

## Development Workflow

### Running Tests

```bash
# All unit tests (Node test runner)
npm test
# or explicitly:
npm run test:unit

# Unit test files live in:
tests/unit/
  bus-emit.test.mjs
  context-md-validator.test.mjs
  domain-store.test.mjs
  manifest.test.mjs
  migrate.test.mjs
  oracle-queries.test.mjs
```

Evals (scenario-driven acceptance tests) are managed separately:

```bash
npm run evals:list     # list available eval scenarios
npm run evals:plan     # plan which evals to run
npm run evals:summary  # summarize eval results
```

### Checking Installation Health

```bash
npx wicked-testing status   # per-CLI installed version
npx wicked-testing doctor   # schema + bootstrap self-test
```

### Validating the Evidence Schema

`schemas/evidence.json` is the public contract for evidence manifests. Any
change to the manifest output format must be accompanied by a schema update
and a passing `manifest.test.mjs` run.

---

## Adding a Skill

1. Create a new directory under `skills/`. The directory name becomes the skill
   ID within the `wicked-testing:` namespace.
2. Write the skill body (markdown). Follow the namespace rules in
   `docs/NAMESPACE.md`.
3. Set `context: fork` in frontmatter for all specialist skills. Workflow
   skills do not set `context: fork`.
4. Declare `allowed-tools` for any skill that restricts its tool access.
5. Run `npx wicked-testing install --force` to copy the new skill into the
   local test CLIs and verify it resolves.
6. If the skill is Tier-1 (public contract), add it to the Tier-1 table in
   `ARCHITECTURE.md` and `docs/INTEGRATION.md`. Tier-2 skills are internal
   and do not require documentation in the public contract.
7. Update the skill count in `README.md` if the total changes.

### Skill Tiers

| Tier | Count | Stability | Consumers may depend on |
|---|---|---|---|
| Workflow | 8 | Stable | Yes — public entry points |
| Tier-1 specialist | 15 | Stable | Yes — dispatch names and outputs |
| Tier-2 specialist | 25 | Internal | No — may change without notice |

---

## Adding an Oracle Query

1. Add the named query to `lib/oracle-queries.mjs`.
2. Add keyword triggers to `routeQuestion()` in the same file.
3. Add a unit test in `tests/unit/oracle-queries.test.mjs`.
4. Update the query list in `DATA-DOMAIN.md`.

No LLM-generated SQL is permitted. Every query must be a fixed parameterized
statement auditable by code review.

---

## Adding a Migration

1. Create `lib/migrations/NNN_description.sql` where NNN is the next integer.
2. The migration must be idempotent (use `CREATE TABLE IF NOT EXISTS`, etc.).
3. Add a test in `tests/unit/migrate.test.mjs` that applies the migration on a
   fresh in-memory database and verifies the schema version.
4. Increment `SCHEMA_VERSION` in `lib/domain-store.mjs` if the migration adds
   or removes columns or tables.

---

## Release Process

### Checklist

- [ ] Unit tests pass: `npm test`
- [ ] Evals pass: scenario-driven acceptance tests via `npm run evals:summary`
- [ ] `npm run prepublishOnly` passes (validates build artifacts)
- [ ] Version bumped in `package.json` following semver
- [ ] `CHANGELOG.md` updated
- [ ] wicked-testing runs its own acceptance pipeline against itself and
      produces a PASS verdict (self-hosting gate)

### npm Publish Flow

```bash
npm version patch|minor|major   # bump version + create git tag
npm publish --access public     # publish to npm registry
```

CI (`release.yml`) runs on tag push and handles publish automatically when
the tag matches the package version.

---

## Project Layout Reference

```
bin/                  CLI entry points (wicked-testing, wicked-vault)
lib/                  Core library (domain-store, migrations, oracle-queries, bus-emit)
skills/               All 48 skills (workflow + Tier-1 + Tier-2)
schemas/              Public JSON schemas (evidence.json)
scenarios/            Scenario files (test-runner.md, examples/)
tests/unit/           Unit test suite
evals/                Eval harness and scenario definitions
docs/                 Public integration docs (INTEGRATION.md, EVIDENCE.md, etc.)
.github/workflows/    CI: ci.yml, evals.yml, release.yml, pages.yml
.product/             DoD artifacts (this directory)
```

---

## Code Conventions

- All library files use `.mjs` extension (ESM).
- No CommonJS (`require()`). No `__dirname` (use `import.meta.url`).
- `better-sqlite3` calls are synchronous. Do not introduce async SQLite.
- JSON files are written before SQLite rows. This order must not be reversed.
- No ad-hoc SQL generation in any skill or library file.
- wicked-bus emission is always fire-and-forget via `lib/bus-emit.mjs`.
