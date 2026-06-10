# wicked-testing — Surface Subtraction (the 5-core, made real)

- **Date:** 2026-06-10
- **Status:** Design — approved (author review complete, 2026-06-10)
- **Target release:** 0.4.0 (breaking; pre-1.0, so a minor under semver-zero)
- **Scope:** The *surface* of wicked-testing — commands, agent roster, and the one organic-use mechanism. **Not** the ledger schema, evidence format, or scenario file format.

---

## 1. Problem

The package.json sells a clean identity: a **"5-core testing surface (plan / authoring / execution / review / insight)"** plus a **3-agent acceptance pipeline**. That story is true and good.

The *implementation* contradicts it. The shipped surface is **41 agents + 15 commands + 12 skills = 68 surfaces.** And the command overlap is self-admitted in the descriptions:

- `insight` says it does "stats, reports, flake detection, coverage gaps" — yet `stats`, `report`, and `oracle` ship as separate commands.
- `authoring` says it covers scenarios — yet `scenarios` ships separately.
- `execution` "runs tests" — and so does `run`; `acceptance` is the rigorous form.

wicked-testing ships **no hooks of its own** (the boot wall and the `git log` sentinel were all wicked-garden). So "make it organic" here is **not a hook-diet problem** — it is a *surface* problem plus *one integration question*: how does an agent get nudged to verify at the right moment.

**Why it matters.** Surface area is inversely proportional to organic use. Faced with 41 specialist agents and 15 overlapping commands, an agent (or a human) at the moment of need cannot pick the right one — so it falls back to "just run the suite myself," and the tools go unused. The cure is not better reminders; it is a smaller surface where the right tool is obvious.

## 2. Principles

- **P1 — The clean story is the target.** Subtract until the implementation matches the advertised 5-core. The most identity-aligned action available is deletion.
- **P2 — Commands hard-cut; agents collapse beneath them.** Typed surfaces (commands) merge 15 → 7 (breaking). Dispatch surfaces (agents) keep their full capability but stop being a pick-list.
- **P3 — Coerce only the crown jewel.** The 3-agent acceptance pipeline (Writer ≠ Executor ≠ Reviewer) is testing's "don't self-grade" gate. It is the one prominent, rigor-bearing door. Everything else earns its use on merit.
- **P4 — Silence until the claim boundary.** Testing speaks exactly once: at a done / "tests pass" assertion with no re-derived verdict on record. Never at boot, never on read-only ops.
- **P5 — Verification is an action; knowledge is the brain.** wicked-testing owns the *act* of verifying. Cross-session memory stays in the `wicked-brain` peer; we do not re-wrap it.

## 3. Target surface — 5-core + the gate + setup

**The brand is preserved:** the 5-core orchestrators stay exactly as advertised; `acceptance` is positioned as the *gate* (the differentiator), not a sixth orchestrator; `setup` is meta.

| Surface | Role | Absorbs (removed) | Dispatches (of the 41 agents) |
|---|---|---|---|
| **plan** | orchestrator | — | test-strategist, risk-assessor, testability-reviewer, requirements-quality-analyst, coverage-archaeologist, test-impact-analyzer |
| **authoring** | orchestrator | `scenarios`, `automate` | test-designer, test-data-manager, test-automation-engineer, incident-to-scenario-synthesizer |
| **execution** | orchestrator | `run`, `ci-bootstrap` | scenario-executor + the 25 `specialists/` (chaos / load / a11y / security / mutation / … fire *here*, by scenario need) |
| **review** | orchestrator | — | semantic-reviewer, test-code-quality-auditor, snapshot-hygiene-auditor, code-analyzer |
| **insight** | orchestrator | `stats`, `report`, `oracle`, `tasks` | flaky-test-hunter, production-quality-engineer, release-readiness-engineer, test-oracle |
| **acceptance** | **the gate (crown jewel)** | — | acceptance-test-writer / -executor / -reviewer |
| **setup** | meta | — | — |

The *Dispatches* column is **representative, not exhaustive** — the full 41-agent roster routes under the 7 per §4; the table only illustrates the obvious homes.

**Commands removed/merged: 8** (`run`, `scenarios`, `automate`, `ci-bootstrap`, `stats`, `report`, `oracle`, `tasks`). **15 → 7.**

`tasks` (DomainStore project tracking) is the one genuine cut rather than merge — it is project-management, not testing; its data stays queryable via `insight`.

## 4. Agents — 41 dispatched, not surfaced

The roster keeps every capability. What changes is *visibility*:

- The 11 top-level + 25 `specialists/` agents become **dispatch targets** reached only via the 7 orchestrators' `Task` calls — never a first-class pick.
- `specialists/` fire when a scenario's type calls for them (a chaos scenario dispatches `chaos-test-engineer`; a load scenario dispatches `load-performance-engineer`). The orchestrator owns the routing; the agent does the work.
- Net: the agent roster is internal plumbing. The *surface* an agent or human reasons about is **7**, not 68.

## 5. The one organic mechanism — the claim-boundary hook

testing's **first and only** hook. The honest form of "hook reminders": single, at the done-claim, ignorable.

- **Default:** off. Opt-in, enabled at `setup`.
- **Event:** `Stop` (turn end).
- **Trigger:** the turn asserts *done / passing / shipped / "tests pass"* **AND** the ledger holds no acceptance verdict for the current scope.
- **Action:** one line — *"Claimed pass; nothing re-derived it. Run `acceptance`?"* Fires at most once per claim. Ignoring it carries zero penalty.
- **Silence rules:** never on read-only ops, never at boot, suppressible per-session and per-repo.
- **Coexistence with garden:** when wicked-garden is present, defer to garden's relocated claim-sentinel — do not double-nudge.

This is the only place a hook earns its keep: it is tied to a real assertion the agent just made, not to session start or to a `git log`.

## 6. Migration (breaking, 0.4.0)

- **Hard delete at 0.4.0.** The 8 removed commands are deleted outright — no stubs, no redirects. A removed name no longer resolves; the harness reports it as unknown. The **CHANGELOG maps every old command to its surviving home** (`stats`/`report`/`oracle`/`tasks` → `insight`; `scenarios`/`automate` → `authoring`; `run`/`ci-bootstrap` → `execution`) so no user is stranded. The functionality is never lost — only the extra door.
- **No data migration.** Ledger schema, evidence JSON, and the scenario file format are **unchanged.** Existing scenarios, runs, and verdicts keep working untouched. This is a surface cut, not a storage change.
- **Skills realign to the 7.** The 12 skills map onto the surviving surfaces; the CLI / skills / agents refresh across detected AI CLIs through the existing `update` path.

## 7. Non-goals

- Not deleting agent capability — the 41 stay as dispatch targets.
- Not adding any hook beyond the single opt-in claim-boundary nudge.
- Not touching the ledger schema, evidence format, or scenario file format.
- Not auto-routing prompts — testing is invoked deliberately; the only nudge is the claim-boundary one.
- Not re-wrapping `wicked-brain` — memory stays in the peer.

## 8. Verification (dogfood)

wicked-testing must prove its own cut with its own scenarios:

1. The existing `scenarios/` suite passes against the collapsed surface.
2. Each absorbed mode has a scenario proving it still works via its new home (e.g., the queries that were `stats` / `report` / `oracle` resolve through `insight`).
3. The acceptance pipeline self-tests — the crown jewel proves itself.
4. The 8 removed commands are absent from the surface, and the CHANGELOG maps each to its surviving home (the functionality is reachable, the door is gone).
5. The claim-boundary hook has two scenarios: a false "tests pass" with no verdict fires exactly **one** nudge; a real recorded verdict **suppresses** it.

## Decisions locked (2026-06-10)

- **Cut depth: hard.** 15 commands → 7; the 8 removed are hard-deleted at 0.4.0 (CHANGELOG maps each to its new home).
- **Acceptance pipeline: a distinct, prominent door** (the gate) — not a hidden mode of `execution`.
- **Organic mechanism: one opt-in claim-boundary hook**, off by default, enabled at `setup`.
- **Memory: delegated to the `wicked-brain` peer** — no wicked-testing memory command.
