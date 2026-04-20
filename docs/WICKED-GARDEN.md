# wicked-garden Integration Guide

wicked-garden depends on wicked-testing for all QE behavior. This guide
explains what moves, what stays, and how to migrate.

---

## TL;DR

- wicked-garden `>= 7.0` ships **without** embedded QE. QE lives in wicked-testing.
- wicked-garden expects wicked-testing to be installed separately via npm.
- On session start, wicked-garden probes `npx wicked-testing --version`. If
  missing, it prints:
  ```
  wicked-testing not installed — run: npx wicked-testing install
  ```
- The `/wicked-garden:qe:*` commands are aliased to `/wicked-testing:*` for
  one minor version, then removed.

---

## What Moved

| wicked-garden 6.x                              | wicked-testing 0.x                       |
|------------------------------------------------|------------------------------------------|
| `/wicked-garden:qe:qe`                         | `/wicked-testing:review`                 |
| `/wicked-garden:qe:qe-plan`                    | `/wicked-testing:plan`                   |
| `/wicked-garden:qe:scenarios`                  | `/wicked-testing:authoring`              |
| `/wicked-garden:qe:automate`                   | `/wicked-testing:authoring`              |
| `/wicked-garden:qe:run`                        | `/wicked-testing:execution`              |
| `/wicked-garden:qe:acceptance`                 | `/wicked-testing:execution` (full loop)  |
| `/wicked-garden:qe:qe-review`                  | `/wicked-testing:review`                 |
| `/wicked-garden:qe:report`                     | `/wicked-testing:insight`                |
| `subagent_type: wicked-garden:qe:<name>`       | `subagent_type: wicked-testing:<name>`   |

The 11 agents that lived under `wicked-garden/agents/qe/` are now in
wicked-testing's `agents/` tree. Their behavior is preserved; only the
namespace changed.

---

## What Stayed

wicked-garden still owns:

- Crew workflow (`/wicked-garden:crew:*`)
- Facilitator and specialist routing
- Gate policy and phase management
- The 13 non-QE domains (product, engineering, data, delivery, platform,
  agentic, jam, mem, search, smaht, persona, etc.)

wicked-garden's crew gate now dispatches QE reviewers by their new
`wicked-testing:*` subagent names (and subscribes to
`wicked.verdict.recorded` events for the result).

---

## Migration Steps (for wicked-garden users)

1. **Upgrade wicked-garden** to `>= 7.0`.
2. **Install wicked-testing**:
   ```bash
   npx wicked-testing install
   ```
   Confirm with:
   ```bash
   npx wicked-testing status
   ```
3. **Verify** by running a smoke project:
   ```
   /wicked-garden:crew:start "tiny refactor"
   ```
   The clarify → design → build → test → review cycle should complete,
   with test and review phases invoking `wicked-testing:*` agents.
4. **Update any gate-policy.json overrides** you may have customized —
   reviewer names should reference `wicked-testing:*`, not
   `wicked-garden:qe:*`.

During the grace period, old command names continue to work with a
deprecation notice. After the grace period, they are removed.

---

## The Public Contract Between Them

wicked-garden consumes these from wicked-testing, and nothing else:

| Surface                                  | Doc                                      |
|------------------------------------------|------------------------------------------|
| Tier-1 skill names                       | [INTEGRATION.md §2](INTEGRATION.md#2-core-skills-tier-1--stable) |
| Tier-1 agent subagent_types              | [INTEGRATION.md §3](INTEGRATION.md#3-core-agents-tier-1--stable-dispatch-names) |
| Bus events                               | [INTEGRATION.md §4](INTEGRATION.md#4-bus-events-public-contract) |
| Evidence manifest schema                 | [EVIDENCE.md](EVIDENCE.md) + [`schemas/evidence.json`](../schemas/evidence.json) |
| Brain memory shapes (optional)           | [INTEGRATION.md §5](INTEGRATION.md#5-brain-memories-optional-enrichment) |

wicked-garden must **not** read wicked-testing's SQLite database, reach
into `lib/`, or reference Tier-2 agent names in `gate-policy.json`. Those
are internal and can change across minor versions.

---

## Version Pinning

wicked-garden's `plugin.json` declares:

```jsonc
{
  "name": "wicked-garden",
  "version": "7.0.0",
  "wicked_testing_version": "^0.1.0"
}
```

The SessionStart hook reads the installed wicked-testing version and warns
if it falls outside the pinned range. Pin updates follow semver.

---

## Troubleshooting

- **Gate errors "unknown subagent_type: wicked-testing:xxx"** — wicked-testing
  isn't installed. Run `npx wicked-testing install`.
- **Gates return empty verdicts** — wicked-bus may not be running. The bus is
  optional in wicked-testing but wicked-garden's crew gate subscribes to
  `wicked.verdict.recorded` to advance. Run `npx wicked-bus status`.
- **Old `/wicked-garden:qe:*` commands missing** — you're on wicked-garden
  `>= 7.1`; the alias layer was removed. Use `/wicked-testing:*`.

---

## Q&A

**Q: Why split at all? More moving parts.**
A: Testing is cross-cutting. Other plugins (and users who never adopt
wicked-garden) want the QE library. Extraction lets wicked-testing evolve on
its own cadence, and keeps wicked-garden focused on SDLC orchestration.

**Q: Can I use wicked-testing without wicked-garden?**
A: Yes — that's the point. See [STANDALONE.md](STANDALONE.md).

**Q: Is SQLite still required?**
A: Yes for wicked-testing's ledger. wicked-bus and wicked-brain are
optional.
