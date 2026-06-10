# Surface Subtraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse wicked-testing's user-facing command surface from 15 → 7 (the advertised 5-core + `acceptance` gate + `setup`), keep all 41 agents as dispatch targets, and add one opt-in claim-boundary hook — shipped as breaking release 0.4.0.

**Architecture:** Commands are markdown-only dispatchers into skills → agents → `lib/`. So 8 of the 15 commands are deleted and their *modes* folded into the surviving 7's command + skill docs; shared logic (`lib/oracle-queries.mjs`, `lib/domain-store.mjs`) is untouched. The one new build is a Stop-hook (`hooks/claim-nudge.mjs`) that, when enabled, nudges to run `acceptance` if a "tests pass" claim lands with no acceptance verdict in the ledger. The repo's gate is `npm test` (`scripts/dev/validate.mjs`, structural + reference-integrity) plus `node scripts/dev/evals.mjs check-all`; the only piece warranting a unit test (`node:test`) is the hook's pure decision function.

**Tech Stack:** Node ≥18 ESM, `better-sqlite3`, markdown skill/command/agent files, `.claude-plugin/plugin.json` manifest, `install.mjs` installer. No new runtime dependencies.

---

## File Structure

**Deleted (8 command files):**
- `commands/run.md`, `commands/ci-bootstrap.md` → execution
- `commands/scenarios.md`, `commands/automate.md` → authoring
- `commands/stats.md`, `commands/report.md`, `commands/oracle.md` → insight
- `commands/tasks.md` → cut (queries remain via insight; mutation surface removed)

**Modified (surviving commands + skills):**
- `commands/execution.md`, `commands/authoring.md`, `commands/insight.md`, `commands/setup.md`
- `skills/execution/SKILL.md`, `skills/authoring/SKILL.md`, `skills/insight/SKILL.md`
- `.claude-plugin/plugin.json` (+ `.claude-plugin/marketplace.json` if it mirrors), `install.mjs`, `package.json`, `CHANGELOG.md`

**Retired/merged skills (12 → ~8):** `scenario-authoring` + `browser-automation` → `authoring`; `test-strategy` → `plan`; `test-oracle` (skill) → `insight` (the `test-oracle` *agent* stays); `test-runner` → split into `execution` + `setup`. Keep: `plan`, `authoring`, `execution`, `review`, `insight`, `acceptance-testing`, `update`, and a `setup` home.

**Created (the hook):**
- `hooks/hooks.json`, `hooks/claim-nudge.mjs`, `hooks/claim-nudge.decision.mjs`, `hooks/claim-nudge.test.mjs`

**Agents:** unchanged on disk (all 41 stay); only their *visibility* changes — they remain dispatch-only, reached via the surviving skills' dispatch tables.

---

## Phase 1 — Command consolidation

> Rhythm for this phase: edit the survivor → delete the dying file(s) → prune `.claude-plugin/plugin.json` → run `npm test` (catches dangling refs via reference-integrity) → commit. The branch `feat/surface-subtraction` already exists and holds the spec.

### Task 1: `insight` absorbs `stats` + `report` + `oracle`; `tasks` is cut

**Files:**
- Modify: `commands/insight.md`
- Modify: `skills/insight/SKILL.md`
- Delete: `commands/stats.md`, `commands/report.md`, `commands/oracle.md`, `commands/tasks.md`
- Modify: `.claude-plugin/plugin.json`

- [ ] **Step 1: Add the absorbed modes to `commands/insight.md`**

Append this section to `commands/insight.md` (before `## References`):

```markdown
## Modes (absorbed in 0.4.0)

`insight` is the single read-only door to the ledger. What used to be separate
commands are now questions you ask it:

| Old command | Ask insight instead |
|-------------|---------------------|
| `stats`     | "domain health" / "row counts" / "schema version" — routes to the `row_counts`, `schema_version`, `recent_runs` oracle queries |
| `report`    | "generate a run report for <project/scope>" — oracle rows rendered as a markdown summary |
| `oracle`    | any plain-language data question — this *is* the oracle; `insight` was always built on it |

Flags `--project`, `--status`, `--since`, `--json` are honored as before.

> **`tasks` is removed, not absorbed.** `insight` is read-only and will not
> create or mutate tasks. Existing task rows remain queryable here
> ("what tasks are open?", "tasks for <project>") via the `tasks_by_status`
> and `tasks_for_project` oracle queries. Task *creation/update* via a command
> is gone in 0.4.0 — use the `DomainStore` API (`lib/domain-store.mjs`) directly
> if a workflow needs it.
```

- [ ] **Step 2: Update `skills/insight/SKILL.md` dispatch table**

In `skills/insight/SKILL.md`, in the `## How it dispatches` table, add these rows so the absorbed modes route explicitly:

```markdown
| "domain health" / "row counts" / "schema version"  | `wicked-testing:test-oracle` → `row_counts` / `schema_version` queries |
| "generate a report" / "run summary"                 | `wicked-testing:test-oracle` rows → markdown summary (no new SQL)      |
| "what tasks are open" / "tasks for X"               | `wicked-testing:test-oracle` → `tasks_by_status` / `tasks_for_project` |
```

No change to `lib/oracle-queries.mjs` is required — those query names already exist (confirmed in `lib/oracle-queries.mjs`).

- [ ] **Step 3: Delete the four command files**

```bash
git rm commands/stats.md commands/report.md commands/oracle.md commands/tasks.md
```

- [ ] **Step 4: Prune `.claude-plugin/plugin.json` (and marketplace.json if present)**

Remove the `stats`, `report`, `oracle`, `tasks` entries from the `commands` array in `.claude-plugin/plugin.json`. Then check the marketplace mirror:

```bash
grep -nE '"(stats|report|oracle|tasks)"' .claude-plugin/plugin.json .claude-plugin/marketplace.json
```
Expected after edit: no matches in a `commands` context (a `tasks` *table* reference in prose is fine; a `commands` entry is not).

- [ ] **Step 5: Run the gate — expect it to catch any dangling references**

Run: `npm test`
Expected: PASS. If it FAILs with a reference-integrity error naming `stats`/`report`/`oracle`/`tasks`, a surviving file still links to a deleted command — fix that link (see Task 5 sweep) and re-run.

- [ ] **Step 6: Commit**

```bash
git add commands/insight.md skills/insight/SKILL.md .claude-plugin/
git commit -m "feat!: insight absorbs stats/report/oracle; cut tasks command (0.4.0)"
```

### Task 2: `authoring` absorbs `scenarios` + `automate`

**Files:**
- Modify: `commands/authoring.md`
- Modify: `skills/authoring/SKILL.md`
- Delete: `commands/scenarios.md`, `commands/automate.md`
- Modify: `.claude-plugin/plugin.json`

- [ ] **Step 1: Add absorbed modes to `commands/authoring.md`**

Append before its references section:

```markdown
## Modes (absorbed in 0.4.0)

| Old command | Ask authoring instead |
|-------------|-----------------------|
| `scenarios` | "write/edit a scenario for <X>" — authoring writes scenario files in the format in `SCENARIO-FORMAT.md` |
| `automate`  | "scaffold browser automation for <X>" — authoring generates the Playwright/Cypress/k6 harness; tool *detection* lives in `setup` |
```

- [ ] **Step 2: Fold scenario + browser dispatch into `skills/authoring/SKILL.md`**

In `skills/authoring/SKILL.md`'s `## How it dispatches` table, add:

```markdown
| "write a scenario" / "edit scenario"                 | scenario-authoring flow (markdown per SCENARIO-FORMAT.md) |
| "scaffold playwright/cypress/k6" / "browser test"    | `wicked-testing:e2e-orchestrator` (run) / harness scaffold; detection via `setup` |
```

- [ ] **Step 3: Delete the command files**

```bash
git rm commands/scenarios.md commands/automate.md
```

- [ ] **Step 4: Prune `.claude-plugin/plugin.json`**

Remove `scenarios` and `automate` from the `commands` array. Verify:
```bash
grep -nE '"(scenarios|automate)"' .claude-plugin/plugin.json .claude-plugin/marketplace.json
```
Expected: no `commands`-array matches.

- [ ] **Step 5: Run the gate**

Run: `npm test`
Expected: PASS (fix any dangling-ref failures naming `scenarios`/`automate`).

- [ ] **Step 6: Commit**

```bash
git add commands/authoring.md skills/authoring/SKILL.md .claude-plugin/
git commit -m "feat!: authoring absorbs scenarios + automate (0.4.0)"
```

### Task 3: `execution` absorbs `run` + `ci-bootstrap`

**Files:**
- Modify: `commands/execution.md`
- Modify: `skills/execution/SKILL.md`
- Delete: `commands/run.md`, `commands/ci-bootstrap.md`
- Modify: `.claude-plugin/plugin.json`

- [ ] **Step 1: Add absorbed modes to `commands/execution.md`**

Append before its references section:

```markdown
## Modes (absorbed in 0.4.0)

| Old command    | Ask execution instead |
|----------------|-----------------------|
| `run`          | "run scenario <path>" — execution dispatches `scenario-executor` and records the run |
| `ci-bootstrap` | "wire CI to run these tests" — execution emits the CI trigger; for the portable evidence gate use wicked-garden's `compile` |
```

- [ ] **Step 2: Note the absorbed paths in `skills/execution/SKILL.md`**

In `skills/execution/SKILL.md`'s `## How it dispatches` table, the `A scenario file → scenario-executor` row already covers `run`. Add one row for CI:

```markdown
| "wire CI" / "bootstrap CI for tests"                     | Emit CI trigger (pre-push / GH Actions step); record nothing until a real run executes |
```

- [ ] **Step 3: Delete the command files**

```bash
git rm commands/run.md commands/ci-bootstrap.md
```

- [ ] **Step 4: Prune `.claude-plugin/plugin.json`**

Remove `run` and `ci-bootstrap` from the `commands` array. Verify:
```bash
grep -nE '"(run|ci-bootstrap)"' .claude-plugin/plugin.json .claude-plugin/marketplace.json
```
Expected: no `commands`-array matches (`run` may legitimately appear elsewhere as a JSON key — inspect context).

- [ ] **Step 5: Run the gate**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add commands/execution.md skills/execution/SKILL.md .claude-plugin/
git commit -m "feat!: execution absorbs run + ci-bootstrap (0.4.0)"
```

### Task 4: Confirm the 7-command surface

- [ ] **Step 1: Assert exactly 7 command files remain**

Run:
```bash
ls commands/*.md | wc -l && ls commands/*.md
```
Expected: `7` and the list is exactly `acceptance.md authoring.md execution.md insight.md plan.md review.md setup.md`.

- [ ] **Step 2: Commit if any stragglers were cleaned**

```bash
git commit -am "chore: confirm 7-command surface" --allow-empty
```

---

## Phase 2 — Skill realignment (12 → ~8)

### Task 5: Merge retired skills into their new homes and sweep dangling references

**Files:**
- Modify: `skills/authoring/SKILL.md` (absorb unique content from `scenario-authoring`, `browser-automation`)
- Modify: `skills/plan/SKILL.md` (absorb unique content from `test-strategy`)
- Modify: `skills/insight/SKILL.md` (absorb unique content from `test-oracle` skill; keep the `test-oracle` *agent*)
- Modify: `skills/execution/SKILL.md` + `skills/setup/SKILL.md` or `commands/setup.md` (absorb `test-runner` content)
- Delete: `skills/scenario-authoring/`, `skills/browser-automation/`, `skills/test-strategy/`, `skills/test-oracle/`, `skills/test-runner/`
- Modify: `.claude-plugin/plugin.json` (`skills` array), `install.mjs` (if it enumerates skills)

- [ ] **Step 1: Preserve unique content before deleting**

For each retired skill, copy any dispatch rows / agent references not already present in the destination skill. Concretely, read each and fold missing rows:
```bash
for s in scenario-authoring browser-automation test-strategy test-oracle test-runner; do echo "=== $s ==="; cat "skills/$s/SKILL.md"; done
```
Fold: `scenario-authoring` + `browser-automation` dispatch rows → `skills/authoring/SKILL.md`; `test-strategy` → `skills/plan/SKILL.md`; `test-oracle` skill's oracle-routing notes → `skills/insight/SKILL.md`; `test-runner`'s run/report/setup notes → `skills/execution/SKILL.md` (run) and `commands/setup.md` (setup/config).

- [ ] **Step 2: Delete the retired skill directories**

```bash
git rm -r skills/scenario-authoring skills/browser-automation skills/test-strategy skills/test-oracle skills/test-runner
```

- [ ] **Step 3: Prune the `skills` array in the manifest**

Remove the five retired skills from `.claude-plugin/plugin.json` `skills`. Check whether `install.mjs` hard-codes a skill list:
```bash
grep -nE 'scenario-authoring|browser-automation|test-strategy|test-oracle|test-runner' install.mjs .claude-plugin/plugin.json .claude-plugin/marketplace.json
```
Update every hit that is a *skill registration* (leave references to the `test-oracle` **agent** in `agents/` intact).

- [ ] **Step 4: Sweep all dangling references repo-wide**

```bash
grep -rnE '/(stats|report|oracle|tasks|run|ci-bootstrap|scenarios|automate)\b' commands/ skills/ agents/ docs/ README.md *.md | grep -iE 'wicked-testing:|commands/|\.md'
```
Fix each surviving link/next-step that points at a deleted command (e.g., `commands/setup.md` "Next steps" lists `/wicked-testing:scenarios` → change to `/wicked-testing:authoring`).

- [ ] **Step 5: Run the gate (this is where reference-integrity earns its keep)**

Run: `npm test`
Expected: PASS. Reference-integrity failures here name the exact file + broken link — fix and re-run until clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor!: 12 skills -> 8, sweep references to removed commands (0.4.0)"
```

### Task 6: Verify all 41 agents are still reachable by dispatch

- [ ] **Step 1: Cross-check every agent against the surviving skills' dispatch tables**

```bash
comm -23 \
  <(find agents -name '*.md' | sed 's|agents/||;s|.*/||;s|\.md$||' | sort -u) \
  <(grep -rhoE 'wicked-testing:[a-z0-9-]+' skills/ | sed 's/wicked-testing://' | sort -u)
```
Expected: empty (every agent name appears in at least one surviving skill's dispatch text). Any agent printed is orphaned — add a dispatch row for it to the most relevant surviving skill (plan/authoring/execution/review/insight/acceptance-testing).

- [ ] **Step 2: Run the gate + commit**

Run: `npm test` → Expected: PASS
```bash
git commit -am "test: assert no agent orphaned by surface cut" --allow-empty
```

---

## Phase 3 — The claim-boundary hook (the only new code)

> Off by default. Reads `.wicked-testing/config.json` `claim_nudge`; silent unless `true`. Pure decision logic is unit-tested with `node:test` (stdlib, no new dep); I/O is a thin shell around it.

### Task 7: The pure decision function (TDD)

**Files:**
- Create: `hooks/claim-nudge.decision.mjs`
- Create: `hooks/claim-nudge.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `hooks/claim-nudge.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldNudge, CLAIM_RE } from './claim-nudge.decision.mjs';

test('nudges when a pass-claim has no acceptance verdict', () => {
  assert.equal(shouldNudge({ enabled: true, lastAssistantText: 'All tests pass, we are done.', hasAcceptanceVerdict: false }), true);
});

test('silent when disabled, even on a claim with no verdict', () => {
  assert.equal(shouldNudge({ enabled: false, lastAssistantText: 'tests pass', hasAcceptanceVerdict: false }), false);
});

test('silent when an acceptance verdict is on record', () => {
  assert.equal(shouldNudge({ enabled: true, lastAssistantText: 'tests pass', hasAcceptanceVerdict: true }), false);
});

test('silent when no claim was made', () => {
  assert.equal(shouldNudge({ enabled: true, lastAssistantText: 'I refactored the parser.', hasAcceptanceVerdict: false }), false);
});

test('claim regex matches the documented phrases', () => {
  for (const s of ['tests pass', 'all green', 'it works now', 'shipped', 'done — verified']) {
    assert.match(s, CLAIM_RE);
  }
  assert.doesNotMatch('I will run the tests next', CLAIM_RE);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --test hooks/claim-nudge.test.mjs`
Expected: FAIL — `Cannot find module './claim-nudge.decision.mjs'`.

- [ ] **Step 3: Implement the minimal decision module**

Create `hooks/claim-nudge.decision.mjs`:

```javascript
// Phrases that count as an unverified "done / it passes" claim.
// Deliberately conservative: future-tense ("will run") must NOT match.
export const CLAIM_RE =
  /\b(tests?\s+pass(ed|ing)?|all\s+green|it\s+works(\s+now)?|shipped|done\b[^.]{0,40}\b(verified|passing|works)|verified\s+(it\s+)?(works|passes))\b/i;

/**
 * @param {{enabled:boolean, lastAssistantText:string, hasAcceptanceVerdict:boolean}} ctx
 * @returns {boolean} whether to surface the one-line nudge
 */
export function shouldNudge(ctx) {
  if (!ctx || ctx.enabled !== true) return false;
  if (ctx.hasAcceptanceVerdict === true) return false;
  return CLAIM_RE.test(ctx.lastAssistantText || '');
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `node --test hooks/claim-nudge.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add hooks/claim-nudge.decision.mjs hooks/claim-nudge.test.mjs
git commit -m "feat: claim-nudge decision function (opt-in, TDD)"
```

### Task 8: The hook I/O shell + the Stop-hook contract

**Files:**
- Create: `hooks/claim-nudge.mjs`
- Create: `hooks/hooks.json`

- [ ] **Step 1: Validate the Stop-hook contract before wiring**

Confirm against the installed Claude Code hooks docs (do not assume): a `Stop` hook receives JSON on **stdin** containing at least `transcript_path`, `session_id`, `cwd`; and a **non-blocking** message is surfaced by exiting `0` and printing the message to **stderr** (a `{"decision":"block"}` payload would force continuation — we must NOT use it). Record the confirmed field names and the non-blocking output channel in a comment at the top of `hooks/claim-nudge.mjs`. If the contract differs, adjust the I/O in Step 2 to match — the decision module (Task 7) is unaffected.

- [ ] **Step 2: Implement the hook shell**

Create `hooks/claim-nudge.mjs`:

```javascript
#!/usr/bin/env node
// Stop hook (opt-in). Contract (confirm via Step 1): stdin JSON has
// { transcript_path, session_id, cwd }. Non-blocking nudge = print to
// stderr and exit 0. NEVER emit {"decision":"block"}.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldNudge } from './claim-nudge.decision.mjs';

function readStdin() {
  try { return JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}
function isEnabled(cwd) {
  try {
    const cfg = JSON.parse(readFileSync(join(cwd, '.wicked-testing', 'config.json'), 'utf8'));
    return cfg.claim_nudge === true;
  } catch { return false; }
}
function lastAssistantText(transcriptPath) {
  try {
    const lines = readFileSync(transcriptPath, 'utf8').trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const e = JSON.parse(lines[i]);
      if (e.role === 'assistant' || e?.message?.role === 'assistant') {
        const c = e.content ?? e.message?.content ?? '';
        return typeof c === 'string' ? c : JSON.stringify(c);
      }
    }
  } catch { /* fall through */ }
  return '';
}
function hasRecentAcceptanceVerdict(cwd) {
  // Deterministic, dependency-light: scan the JSON ledger for a verdict whose
  // source is the acceptance pipeline, recorded in the last 30 minutes.
  try {
    const dir = join(cwd, '.wicked-testing', 'verdicts');
    const { readdirSync } = require('node:fs'); // eslint-disable-line
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const v = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      const t = Date.parse(v.created_at || v.recorded_at || 0);
      if (t >= cutoff && /accept/i.test(v.source || v.pipeline || '')) return true;
    }
  } catch { /* no ledger => no verdict */ }
  return false;
}

const input = readStdin();
const cwd = input.cwd || process.cwd();
const enabled = isEnabled(cwd);
const lastText = enabled ? lastAssistantText(input.transcript_path || '') : '';
const hasVerdict = enabled ? hasRecentAcceptanceVerdict(cwd) : false;

if (shouldNudge({ enabled, lastAssistantText: lastText, hasAcceptanceVerdict: hasVerdict })) {
  process.stderr.write(
    'wicked-testing: you claimed the tests pass, but nothing re-derived it. ' +
    'Run `/wicked-testing:acceptance <scenario>` for an independent verdict.\n'
  );
}
process.exit(0);
```

> Note: `require` inside ESM needs `createRequire`. Replace the inline `require('node:fs')` with a top-level `import { readdirSync } from 'node:fs';` and use it directly — fix this when implementing (the test in Task 7 does not cover I/O, so add a quick manual check in Step 4).

- [ ] **Step 3: Create `hooks/hooks.json`**

```json
{
  "description": "wicked-testing — one opt-in claim-boundary nudge",
  "hooks": {
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/claim-nudge.mjs\"",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 4: Manual I/O smoke test (no test runner for hooks)**

Run (simulates an enabled project with a pass-claim and no verdict):
```bash
mkdir -p /tmp/wt-hooktest/.wicked-testing/verdicts
echo '{"claim_nudge":true}' > /tmp/wt-hooktest/.wicked-testing/config.json
printf '%s\n' '{"role":"assistant","content":"All tests pass, done."}' > /tmp/wt-hooktest/transcript.jsonl
printf '%s' '{"transcript_path":"/tmp/wt-hooktest/transcript.jsonl","cwd":"/tmp/wt-hooktest"}' | node hooks/claim-nudge.mjs; echo "exit=$?"
```
Expected: the nudge string on stderr, `exit=0`. Then flip `claim_nudge` to `false` and re-run → expect **no** output, `exit=0`.

- [ ] **Step 5: Commit**

```bash
git add hooks/claim-nudge.mjs hooks/hooks.json
git commit -m "feat: opt-in Stop hook that nudges to acceptance on an unverified pass-claim"
```

### Task 9: Wire the opt-in (setup) and the install paths

**Files:**
- Modify: `commands/setup.md`
- Modify: `install.mjs`, `package.json` (`files` array)

- [ ] **Step 1: Teach `setup` to write the opt-in flag**

In `commands/setup.md` Step 3 (config.json), add `'claim_nudge': False` to the config dict, and add a line under "Next steps" / a new prompt:
```markdown
- **Claim-boundary nudge (optional):** set `"claim_nudge": true` in
  `.wicked-testing/config.json` to be reminded to run `acceptance` whenever a
  turn claims "tests pass" with no acceptance verdict on record. Off by default.
```
Also fix the stale "Next steps" reference: change `/wicked-testing:scenarios` → `/wicked-testing:authoring`.

- [ ] **Step 2: Ship the hook in the package**

Add `"hooks/"` to the `files` array in `package.json` so the hook is published.

- [ ] **Step 3: Register the hook for the loose-skill install path**

`install.mjs` copies skills individually (not a plugin dir), so `hooks/hooks.json` is auto-discovered **only** under marketplace/plugin-mode install. For the loose path, add to `install.mjs`: when installing for Claude Code, merge a `Stop` hook entry pointing at the installed `hooks/claim-nudge.mjs` into the user's `settings.json` **only if** the user opts in (guard behind the same `claim_nudge` notion or an `--enable-claim-nudge` install flag). Concretely:
- Locate the Claude settings file via the existing `$CLAUDE_CONFIG_DIR` resolution already in `install.mjs`.
- Read-modify-write its `hooks.Stop` array idempotently (do not clobber existing hooks; skip if an entry for `claim-nudge.mjs` already exists).
- Document in `--help` and `doctor` output whether the nudge is registered.

> If this step's scope is larger than the release window allows, ship the hook as **plugin-mode-only** for 0.4.0 (it is auto-discovered + flag-gated there) and file a follow-up for loose-path registration. Note the chosen path in the CHANGELOG.

- [ ] **Step 4: Run the gate + commit**

Run: `npm test` → Expected: PASS
```bash
git add commands/setup.md install.mjs package.json
git commit -m "feat: opt-in claim-nudge wiring (setup flag + install registration)"
```

---

## Phase 4 — Release prep (0.4.0)

### Task 10: CHANGELOG, version bump, version-sync, full gate

**Files:**
- Modify: `CHANGELOG.md`, `package.json`

- [ ] **Step 1: Add the 0.4.0 CHANGELOG entry**

Prepend under the top of `CHANGELOG.md` (Keep a Changelog style):

```markdown
## [0.4.0] — 2026-06-10

**Breaking: command surface cut 15 → 7.** The advertised 5-core
(`plan`/`authoring`/`execution`/`review`/`insight`) + `acceptance` (the gate)
+ `setup`. The 41 agents are unchanged and remain reachable by dispatch.

### Removed (hard cut — map to the surviving home)
- `stats`, `report`, `oracle` → ask `insight`
- `tasks` → removed; task rows stay queryable via `insight`, mutation via the `DomainStore` API
- `scenarios`, `automate` → ask `authoring`
- `run`, `ci-bootstrap` → ask `execution`

### Added
- Opt-in claim-boundary Stop hook: when enabled (`claim_nudge: true` in
  `.wicked-testing/config.json`), nudges to run `acceptance` if a turn claims
  "tests pass" with no acceptance verdict on record. Off by default.
  [plugin-mode auto-discovered; loose-install registration: see note]

### Changed
- 12 skills → 8 (scenario-authoring + browser-automation → authoring;
  test-strategy → plan; test-oracle skill → insight; test-runner → execution + setup).

### Unchanged
- Ledger schema, evidence format, and scenario file format are untouched.
```

- [ ] **Step 2: Bump the version and sync the manifest**

```bash
npm version 0.4.0 --no-git-tag-version
node scripts/dev/sync-plugin-version.mjs
```
Expected: `package.json` and `.claude-plugin/plugin.json` both at `0.4.0`.

- [ ] **Step 3: Run the full gate**

Run: `npm test`
Expected: PASS (`validate.mjs` clean + version-sync `--check` clean).

- [ ] **Step 4: Run the structural eval gate (no API cost)**

Run: `node scripts/dev/evals.mjs check-all`
Expected: PASS — no eval references a removed command/skill. Fix any that do.

- [ ] **Step 5: Commit (do NOT publish — that is the author's call)**

```bash
git add CHANGELOG.md package.json .claude-plugin/
git commit -m "release: v0.4.0 — surface cut 15->7 + opt-in claim-boundary hook"
```

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task:
- §3 target surface (15→7) → Tasks 1–4 (+ confirm Task 4).
- §4 agents dispatched not surfaced → Task 6 (orphan check); agents untouched on disk.
- §5 the one opt-in hook → Tasks 7–9.
- §6 hard delete + CHANGELOG mapping → Task 1/2/3 deletions + Task 10 CHANGELOG.
- §6 "no data migration" → asserted in CHANGELOG "Unchanged"; no task touches `lib/migrations/` or schemas.
- §8 verification (dogfood) → `npm test` after every task + `evals check-all` (Task 10 Step 4) + hook tests (Task 7) + hook smoke (Task 8).

**2. Placeholder scan** — the only deferred decision is Task 9 Step 3 (loose-install registration), which is explicitly bounded with a fallback (plugin-mode-only for 0.4.0) and a CHANGELOG note — not a silent TODO. The hook's ESM `require` slip is flagged inline with the exact fix.

**3. Type/name consistency** — `shouldNudge` / `CLAIM_RE` names match between `claim-nudge.decision.mjs`, its test, and `claim-nudge.mjs`. The config flag is `claim_nudge` everywhere (setup, hook, CHANGELOG, install). Command-name mappings match the spec's §6 table exactly.

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-06-10-surface-subtraction.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, two-stage review between tasks, fast iteration. Best here because the phases are independent and the reference-integrity gate gives each subagent a crisp pass/fail.
2. **Inline Execution** — execute tasks in this session via `superpowers:executing-plans`, batched with checkpoints for review.

Which approach?
