---
name: wicked-testing-validate
description: |
  Repo-local structural validator for wicked-testing. Checks agent frontmatter,
  plugin.json reference integrity, namespace alignment, and evidence schema
  self-consistency. Zero LLM cost. Run before publishing or after structural
  changes.

  Use when: validating wicked-testing's own skills/agents/plugin.json,
  pre-publish sanity check, after adding new agents or skills to this repo.
---

# wicked-testing-validate (dev skill)

Repo-local dev skill. Only activates when Claude Code runs inside the
wicked-testing repo. Not shipped to npm. Not installed into consumers.

## What it checks

1. **Agent frontmatter** — every `agents/**/*.md` has required fields
   (`name`, `subagent_type`, `description`, `model`, `allowed-tools`)
2. **Namespace** — `subagent_type` starts with `wicked-testing:`
3. **Filename ↔ name match** — frontmatter `name` matches filename
4. **Skill frontmatter** — every `skills/**/SKILL.md` has `name` + `description`
5. **plugin.json integrity** — every `skills[].path`, `agents[].path`,
   `commands[].path` resolves to a real file
6. **Orphan skills** — skill dirs present on disk but not registered in
   plugin.json (warn)
7. **Evidence schema** — `schemas/evidence.json` has `$schema`, `$id`,
   `required`
8. **Namespace docs** — every Tier-1 agent is referenced in
   `docs/NAMESPACE.md`

## How to run

```bash
node scripts/dev/validate.mjs          # human output
node scripts/dev/validate.mjs --json   # machine output
node scripts/dev/validate.mjs --quiet  # exit code only
```

Exit code 0 = clean, 1 = errors present.

## When to dispatch

- Before a commit that touches `agents/`, `skills/`, `plugin.json`,
  `schemas/`, or `docs/NAMESPACE.md`
- Before `npm publish` as a pre-publish check
- After merging a PR that adds agents or restructures skills

## Promotion path

If consumers want the same capability (validate their own plugin structure),
promote by moving logic into `skills/validate/` as a shipped skill and
bumping the minor version. For now, dev-local.

## References

- `scripts/dev/validate.mjs` — implementation
- [docs/NAMESPACE.md](../../../docs/NAMESPACE.md) — source of truth for names
- [schemas/evidence.json](../../../schemas/evidence.json) — schema reference
