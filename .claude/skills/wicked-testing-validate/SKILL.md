---
name: wicked-testing-validate
description: |
  Repo-local structural validator for wicked-testing. Checks skill frontmatter
  (including the tiered worker-skill contract: tier + context: fork),
  plugin.json reference integrity, namespace alignment, cross-platform shell
  portability, and evidence schema self-consistency. Zero LLM cost. Run before
  publishing or after structural changes.

  Use when: validating wicked-testing's own skills/plugin.json,
  pre-publish sanity check, after adding new skills to this repo.
---

# wicked-testing-validate (dev skill)

Repo-local dev skill. Only activates when Claude Code runs inside the
wicked-testing repo. Not shipped to npm. Not installed into consumers.

## What it checks

1. **Skills-only layout** — the legacy `agents/` and `commands/` directories
   must NOT exist; if either reappears the run fails (the distribution is
   skills-only — former agents are forked worker skills, former commands
   folded into their same-named orchestrator skills)
2. **Skill frontmatter** — every `skills/**/SKILL.md` has `name` +
   `description`
3. **Worker-skill contract** — every tiered skill (`tier: 1` or `tier: 2`,
   the former agents) also declares `context: fork` (isolated dispatch —
   preserves writer/executor/reviewer isolation), `model`, and
   `allowed-tools`; a skill with `context: fork` but no tier is warned
4. **Namespace** — frontmatter `name` equals `wicked-testing:<dir>` exactly
   (the plugin-namespaced form Claude Code's skill resolver requires)
5. **plugin.json integrity** — every `skills[].path` resolves to a real
   file; legacy `agents`/`commands` arrays in the manifest are errors
6. **Orphan skills** — skill dirs present on disk but not registered in
   plugin.json (warn)
7. **Evidence schema** — `schemas/evidence.json` has `$schema`, `$id`,
   `required`
8. **Namespace docs** — every `tier: 1` skill is listed in the Tier-1
   section of `docs/NAMESPACE.md`, and no tiered skill sits in the wrong
   tier section
9. **Cross-platform shell portability** — fenced bash blocks in `skills/`,
   `scenarios/`, and `SCENARIO-FORMAT.md` are scanned for Unix-only
   constructs (bare `/tmp`, `echo -e`, unguarded `2>/dev/null`, GNU-only
   tools, ...) per the global CLAUDE.md portability rule (warn)

## How to run

```bash
node scripts/dev/validate.mjs          # human output
node scripts/dev/validate.mjs --json   # machine output
node scripts/dev/validate.mjs --quiet  # exit code only
```

Exit code 0 = clean, 1 = errors present.

## When to dispatch

- Before a commit that touches `skills/`, `plugin.json`, `schemas/`, or
  `docs/NAMESPACE.md`
- Before `npm publish` as a pre-publish check
- After merging a PR that adds skills or restructures the skills tree

## Promotion path

If consumers want the same capability (validate their own plugin structure),
promote by moving logic into `skills/validate/` as a shipped skill and
bumping the minor version. For now, dev-local.

## References

- `scripts/dev/validate.mjs` — implementation
- [docs/NAMESPACE.md](../../../docs/NAMESPACE.md) — source of truth for names
- [schemas/evidence.json](../../../schemas/evidence.json) — schema reference
