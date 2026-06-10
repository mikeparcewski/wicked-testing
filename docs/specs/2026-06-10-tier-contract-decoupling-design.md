# Tier-Contract Decoupling — wicked-testing ⇄ wicked-garden

- **Date:** 2026-06-10
- **Status:** Design — approved (author approved approach + sub-decisions A–D, 2026-06-10)
- **Repos:** `wicked-testing` (publisher) + `wicked-garden` (consumer)
- **Scope:** Replace the hard-coded mirrors of wicked-testing's Tier-1 agent contract in wicked-garden with a single metadata-sourced, published contract. **Not** in scope: cutting any agent (the roster stays at 41), changing agent behavior, or the wider archetype/gate engine.

---

## 1. Problem

wicked-garden hard-codes wicked-testing's Tier-1 agent contract in **three** hand-maintained mirrors, each drifted differently, plus **two** prose copies in wicked-testing — five copies of one truth:

| Copy | Location | State |
|------|----------|-------|
| `TIER1_AGENTS` frozenset | `wicked-garden/scripts/_wicked_testing_tier1.py:9-26` | 16 agents; "frozen, needs a major bump" |
| `tier1_agents` array | `wicked-garden/.claude-plugin/specialist.json:27-39` | **11/16** — silently incomplete |
| `qe` domain | `wicked-garden/.claude-plugin/components.json:20` | **1/16** (just `semantic-reviewer`) |
| Tier-1 table (prose) | `wicked-testing/docs/INTEGRATION.md §3` | hand-copied |
| Tier-1 table (prose) | `wicked-testing/docs/NAMESPACE.md:26-45` | hand-copied |

The garden mirror is consumed by `wicked-garden/.claude/commands/wg-check.md` (`validate_gate_policy()`, `is_valid_wt_reviewer()`) to lint garden's `gate-policy.json` reviewer references. **Tier is currently implicit** — inferred from directory (`agents/` = Tier-1, `agents/specialists/` = Tier-2); there is **no `tier:` field** in agent frontmatter today (confirmed: `agents/test-strategist.md` and `agents/specialists/ui-component-test-engineer.md` carry `name`/`subagent_type`/`model`/`effort`/`max-turns`/`color`/`allowed-tools`, no `tier`).

**Why it matters:** any change to wicked-testing's agent roster silently breaks or staleifies garden's mirrors. It already has — the three garden copies disagree (16 / 11 / 1). This is a hard tie between two repos that should compose loosely.

## 2. Goal & principles

- **One source of truth:** tier is **metadata on the agent** (`tier:` frontmatter). Everything else is derived.
- **garden derives, never mirrors.** No wicked-testing agent names hard-coded in garden.
- **The boundary is a published artifact, not a shared symbol.** garden reads wicked-testing's published contract; it never imports testing's internals.
- **The bus is a refresh hint, never the source of truth.** A gate/lint cannot depend on fire-and-forget delivery to know what's valid.
- **Fail-closed, never fail-wide.** If the contract can't be resolved, degrade to a last-known snapshot and warn — never silently widen what counts as valid.

## 3. The interface (the entire cross-repo boundary)

Each entry in wicked-testing's `.claude-plugin/plugin.json` `agents[]` array gains one field:

```json
{ "name": "test-strategist", "path": "agents/test-strategist.md", "tier": 1 }
{ "name": "ui-component-test-engineer", "path": "agents/specialists/ui-component-test-engineer.md", "tier": 2 }
```

`plugin.json` is already generated/validated by `scripts/dev/validate.mjs` and already shipped in `package.json` `files[]`. Adding `tier` makes it the machine-readable contract with **no new artifact**. This single field is the only thing that crosses the repo boundary.

## 4. wicked-testing changes (the publisher)

1. **Frontmatter `tier:` on all 41 agents** — `tier: 1` on the 16 top-level, `tier: 2` on the 25 specialists.
2. **`scripts/dev/validate.mjs` becomes the publisher/enforcer:**
   - **Assert** every agent declares `tier: 1|2`. Missing/invalid → gate fails (`npm test` red).
   - **(Decision A)** Assert frontmatter tier agrees with directory (`tier: 2` ⟺ under `agents/specialists/`). A misfiled agent fails the gate.
   - **Bake `tier`** into each `plugin.json` `agents[]` entry (generation).
   - **Assert the prose tables match** — `docs/NAMESPACE.md` and `docs/INTEGRATION.md` Tier-1/Tier-2 tables must agree with the metadata, or `npm test` fails. (Eliminates prose drift; the tables become checked, not hand-copied.)
3. **(Decision B) Bus event, non-load-bearing:** add `wicked.contract.published` to `lib/bus-emit.mjs`'s catalog; emit `{ version, agents: [{subagent_type, tier}] }` when the contract is regenerated (e.g., on `prepublishOnly` / a release step). Fire-and-forget; nothing in either repo's correctness depends on it. It exists so consumers can *refresh* a cache, matching the project's existing bus-emit pattern.

## 5. wicked-garden changes (the consumer)

1. **`scripts/_wicked_testing_tier1.py` → a resolver, not a list.** Delete the `TIER1_AGENTS`/`TIER2_AGENTS` frozensets. Replace with:
   - `load_contract()` — resolve wicked-testing's installed `plugin.json` (via the plugin/skill install path, falling back to `npm`/`npx` resolution), parse `agents[].tier`, return `{tier1: set, tier2: set}`.
   - Keep `is_valid_wt_reviewer(name)` and `validate_gate_policy(dict)` signatures **unchanged** — callers in `wg-check.md` (lines 98/136/157) keep working; only the backing data source changes.
2. **Bundled fallback snapshot.** Commit `wicked-garden/.claude-plugin/wt-contract.snapshot.json` (last-known-good `{agents:[{subagent_type,tier}]}`). `load_contract()` uses it when testing isn't resolvable, **and emits a warning**. A garden CI check asserts the snapshot still matches testing's current published contract (so it can't rot silently).
3. **(Decision C) Drop the `specialist.json` mirror.** Remove the `tier1_agents` array from `.claude-plugin/specialist.json`; consumers use the resolver. (`components.json`'s `qe` list describes garden's *own* domains and is left, but its membership is no longer a testing-contract mirror.)
4. **(Decision D) Fix the stale command reference** at `scripts/sentinel/invariants.py:274` — `wicked-testing:run` → `wicked-testing:execution` (a 0.4.0 removal).

## 6. Data flow

```
author sets `tier:` in agent frontmatter
   → validate.mjs bakes tier into plugin.json (+ asserts docs match)   [wicked-testing build/test]
   → validate.mjs emits wicked.contract.published                       [optional, on release]
   → garden load_contract() reads testing's installed plugin.json       [or refreshes on the bus event]
   → derives {tier1, tier2}
   → wg-check validate_gate_policy() lints gate-policy.json reviewers
```

## 7. Error handling / degradation

| Condition | Behavior |
|-----------|----------|
| Agent missing/invalid `tier:` | `validate.mjs` fails — `npm test` red (publisher-side gate). |
| Frontmatter tier ≠ directory | `validate.mjs` fails (Decision A). |
| Docs tables ≠ metadata | `validate.mjs` fails (no prose drift). |
| wicked-testing not resolvable in garden | `load_contract()` returns the bundled snapshot **and warns**; never crashes, never widens validity. |
| Bus down / event missed | Zero correctness impact — resolver reads `plugin.json` directly; the event is only a refresh hint. |
| Snapshot rots vs current contract | garden CI consistency check fails until refreshed. |

## 8. Testing

**wicked-testing:** extend `validate.mjs` self-checks — (a) every agent tiered; (b) tier↔directory agree; (c) `plugin.json` `tier` matches frontmatter; (d) NAMESPACE/INTEGRATION tables match metadata. All run under `npm test`.

**wicked-garden:** unit-test `load_contract()` — fixture `plugin.json` → correct `{tier1,tier2}`; unresolvable → bundled snapshot + warning; malformed → fail-closed. Test `is_valid_wt_reviewer()`/`validate_gate_policy()` against the resolver (behavior unchanged vs. the old frozenset for the current roster). Add the snapshot-consistency CI check.

## 9. Sequencing

1. **wicked-testing first** — it defines the `plugin.json` `tier` shape garden reads. Land + (optionally) publish before garden consumes.
2. **wicked-garden second** — swap the mirrors for the resolver, add the fallback snapshot (seeded from testing's now-published contract), drop the `specialist.json` mirror, fix the `run` ref.

Two PRs (one per repo). The garden PR's snapshot is seeded from the testing PR's published `plugin.json`.

## 10. Non-goals

- Not cutting any agent (roster stays 41; `continuous-quality-monitor` and `code-analyzer` remain — the decoupling makes a *future* trim a free local change).
- Not changing agent behavior, the bus's design, or garden's gate engine.
- Not building a general capability-registry service — `plugin.json` + one optional event is the whole mechanism (YAGNI).

## Decisions locked (2026-06-10)

- **A** — `validate.mjs` asserts frontmatter `tier` agrees with directory.
- **B** — emit `wicked.contract.published`, strictly non-load-bearing (refresh hint).
- **C** — remove `specialist.json`'s `tier1_agents` mirror; consumers use the resolver.
- **D** — fix `wicked-garden/scripts/sentinel/invariants.py:274` `run`→`execution` in this work.
