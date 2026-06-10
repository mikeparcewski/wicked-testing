# Tier-Contract Decoupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace wicked-garden's three drifted hand-mirrors of wicked-testing's tier-1 agent contract with a single metadata source (`tier:` frontmatter), published via `plugin.json` + a `contract` CLI subcommand, consumed by a garden resolver.

**Architecture:** `tier:` frontmatter on each wicked-testing agent is the sole source. The existing `sync-plugin-version.mjs` generator bakes `tier` into `plugin.json` `agents[]`; `validate.mjs` enforces it. A new `npx wicked-testing contract --json` subcommand emits the contract (the cross-repo boundary). garden's `_wicked_testing_tier1.py` becomes a resolver that calls that subcommand (mirroring its existing `npx wicked-testing --version` probe), with a committed snapshot fallback. An optional `wicked.contract.published` bus event is a refresh hint only. No wicked-testing names are hardcoded in garden.

**Tech Stack:** wicked-testing — Node ESM, `node --test`, the `validate.mjs`/`sync-plugin-version.mjs` dev scripts, `install.mjs` bin. wicked-garden — Python stdlib, `pytest`.

**Refinement vs spec:** the spec said garden "reads testing's installed `plugin.json`"; this plan uses the cleaner `npx wicked-testing contract --json` subcommand as the npx-resolution the spec named — the bin is the boundary, so garden never touches testing's filesystem.

---

## File Structure

**wicked-testing (Phase A — publisher):**
- Modify: all 41 `agents/*.md` + `agents/specialists/*.md` (add `tier:`)
- Modify: `scripts/dev/validate.mjs` (enforce `tier`)
- Modify: `scripts/dev/sync-plugin-version.mjs` (`listAgents()` bakes `tier`)
- Modify: `.claude-plugin/plugin.json` (regenerated — `agents[]` gains `tier`)
- Modify: `docs/NAMESPACE.md`, `docs/INTEGRATION.md` (tier tables asserted against metadata; new event documented)
- Modify: `install.mjs` (add `contract` subcommand)
- Modify: `lib/bus-emit.mjs` (add `wicked.contract.published`)
- Test: `hooks/`-style — `node --test` for the contract subcommand output shape

**wicked-garden (Phase B — consumer):**
- Modify: `scripts/_wicked_testing_tier1.py` (frozensets → resolver)
- Create: `.claude-plugin/wt-contract.snapshot.json` (bundled fallback)
- Create: `tests/test_wicked_testing_contract.py` (resolver tests)
- Modify: `.claude-plugin/specialist.json` (drop `tier1_agents` mirror)
- Modify: `scripts/sentinel/invariants.py:274` (`run` → `execution`)
- Modify: a garden CI step (snapshot-vs-live consistency check)

---

## Phase A — wicked-testing (the publisher)

> Branch: `feat/tier-contract-decoupling` (already created off `main`). Gate: `npm test`.

### Task A1: `tier:` frontmatter + validate.mjs enforcement

**Files:**
- Modify: `scripts/dev/validate.mjs` (extend `checkAgents`)
- Modify: all 41 agent `.md` files

- [ ] **Step 1: Add the failing enforcement to `validate.mjs`**

In `scripts/dev/validate.mjs`, in `checkAgents()` (currently lines 80-104), after the existing `requiredFields` loop add tier enforcement. Replace the `requiredFields` array (line 82) to include `tier`:

```javascript
  const requiredFields = ["name", "subagent_type", "description", "model", "allowed-tools", "tier"];
```

And inside the per-file loop, after the `subagent_type` check (after line 97), add:

```javascript
      // tier: explicit metadata, single source of truth for the public contract.
      const tier = fm.tier;
      if (tier !== "1" && tier !== "2") {
        err("agents", rel, `tier must be 1 or 2 (got: ${tier ?? "missing"})`);
      } else {
        // Decision A: frontmatter tier must agree with directory.
        const inSpecialists = path.includes(join("agents", "specialists"));
        if (tier === "2" && !inSpecialists) {
          err("agents", rel, `tier: 2 but not under agents/specialists/`);
        }
        if (tier === "1" && inSpecialists) {
          err("agents", rel, `tier: 1 but under agents/specialists/ (specialists are tier 2)`);
        }
      }
```

(`parseFrontmatter` returns scalar values as strings, so `fm.tier` is `"1"`/`"2"`.)

- [ ] **Step 2: Run the gate — confirm it fails (no agent has tier yet)**

Run: `npm test`
Expected: FAIL — `~41` errors `[agents] ... missing required frontmatter key: tier`.

- [ ] **Step 3: Add `tier:` to every agent's frontmatter**

Run this one-time inserter (adds `tier:` after the `name:` line; tier derived from directory, which is correct by definition and will satisfy the directory-agreement check):

```bash
node --input-type=module -e '
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const REPO = process.cwd();
for (const [dir, tier] of [["agents", "1"], ["agents/specialists", "2"]]) {
  for (const f of readdirSync(join(REPO, dir)).filter(x => x.endsWith(".md"))) {
    const p = join(REPO, dir, f);
    let c = readFileSync(p, "utf8");
    if (/^tier:\s/m.test(c.split("---")[1] ?? "")) continue; // already has tier
    // insert `tier: N` immediately after the first `name:` line inside frontmatter
    c = c.replace(/^(name:.*)$/m, `$1\ntier: ${tier}`);
    writeFileSync(p, c);
  }
}
console.log("tier added");
'
```

- [ ] **Step 4: Run the gate — confirm green**

Run: `npm test`
Expected: PASS (0 errors). If any agent fails the directory-agreement check, a file is misfiled — move it or fix its tier.

- [ ] **Step 5: Commit**

```bash
git add scripts/dev/validate.mjs agents/
git commit -m "feat: tier: frontmatter on all agents + validate enforcement (single-source contract)"
```

### Task A2: Bake `tier` into `plugin.json` via the existing generator

**Files:**
- Modify: `scripts/dev/sync-plugin-version.mjs` (`listAgents()`)
- Modify: `.claude-plugin/plugin.json` (regenerated)

- [ ] **Step 1: Extend `listAgents()` to read frontmatter tier**

In `scripts/dev/sync-plugin-version.mjs`, add a tiny frontmatter-tier reader near the top (after the imports, ~line 22) — `readFileSync` is already imported:

```javascript
function tierOf(absPath) {
  try {
    const c = readFileSync(absPath, "utf8");
    const fm = c.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const m = fm && fm[1].match(/^tier:\s*([12])\s*$/m);
    return m ? Number(m[1]) : null;
  } catch { return null; }
}
```

Then change `listAgents()` (lines 59-74) so each entry includes `tier` (read from the file on disk):

```javascript
function listAgents() {
  const dir = join(REPO, "agents");
  if (!existsSync(dir)) return [];
  const direct = readdirSync(dir)
    .filter(f => f.endsWith(".md"))
    .sort()
    .map(f => ({ name: f.replace(/\.md$/, ""), path: `agents/${f}`, tier: tierOf(join(dir, f)) }));
  const specDir = join(dir, "specialists");
  const specialists = existsSync(specDir)
    ? readdirSync(specDir)
        .filter(f => f.endsWith(".md"))
        .sort()
        .map(f => ({ name: f.replace(/\.md$/, ""), path: `agents/specialists/${f}`, tier: tierOf(join(specDir, f)) }))
    : [];
  return [...direct, ...specialists];
}
```

- [ ] **Step 2: Regenerate `plugin.json`**

Run: `node scripts/dev/sync-plugin-version.mjs`
Expected: `plugin.json updated: - agents (41 -> 41)` (the diff is the new `tier` field on each entry).

- [ ] **Step 3: Verify the contract is in plugin.json + gate green**

Run:
```bash
node -e "const a=require('./.claude-plugin/plugin.json').agents; const bad=a.filter(x=>x.tier!==1&&x.tier!==2); console.log('agents:',a.length,'tier1:',a.filter(x=>x.tier===1).length,'tier2:',a.filter(x=>x.tier===2).length,'untiered:',bad.length)"
npm test
```
Expected: `tier1: 16 tier2: 25 untiered: 0`; `npm test` PASS (`sync --check` now consistent).

- [ ] **Step 4: Commit**

```bash
git add scripts/dev/sync-plugin-version.mjs .claude-plugin/plugin.json
git commit -m "feat: bake agent tier into plugin.json (the published contract)"
```

### Task A3: Assert the prose tier tables match metadata

**Files:**
- Modify: `scripts/dev/validate.mjs` (replace `checkNamespaceAlignment`)
- Modify: `docs/NAMESPACE.md`, `docs/INTEGRATION.md` (correct any mismatches)

- [ ] **Step 1: Strengthen the namespace check to a tier assertion**

Replace `checkNamespaceAlignment()` (lines 347-363) so it asserts every tier-1 agent token appears in NAMESPACE.md AND that no tier-2 agent is listed as tier-1. Read each agent's tier from frontmatter (reuse the directory split):

```javascript
function checkNamespaceAlignment() {
  const docPath = join(REPO, "docs", "NAMESPACE.md");
  const rel = relative(REPO, docPath);
  if (!existsSync(docPath)) { err("namespace", rel, "NAMESPACE.md missing"); return; }
  const doc = readFileSync(docPath, "utf8");
  // Tier-1 section heading per NAMESPACE.md: "Agents (Tier-1" ... "Agents (Tier-2"
  const t1Start = doc.indexOf("Tier-1");
  const t2Start = doc.indexOf("Tier-2");
  const t1Section = t1Start >= 0 ? doc.slice(t1Start, t2Start >= 0 ? t2Start : undefined) : "";
  const t2Section = t2Start >= 0 ? doc.slice(t2Start) : "";
  for (const [dir, tier] of [["agents", "1"], [join("agents", "specialists"), "2"]]) {
    const d = join(REPO, dir);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).filter(x => x.endsWith(".md"))) {
      const token = `wicked-testing:${f.replace(/\.md$/, "")}`;
      const inT1 = t1Section.includes(token);
      const inT2 = t2Section.includes(token);
      if (tier === "1" && !inT1) err("namespace", rel, `Tier-1 agent '${token}' missing from NAMESPACE.md Tier-1 section`);
      if (tier === "2" && !inT2) err("namespace", rel, `Tier-2 agent '${token}' missing from NAMESPACE.md Tier-2 section`);
      if (tier === "1" && inT2) err("namespace", rel, `Tier-1 agent '${token}' wrongly listed under Tier-2`);
      if (tier === "2" && inT1) err("namespace", rel, `Tier-2 agent '${token}' wrongly listed under Tier-1`);
    }
  }
}
```

- [ ] **Step 2: Run the gate; fix any doc mismatch it reports**

Run: `npm test`
Expected: either PASS, or specific errors naming agents in the wrong NAMESPACE.md section. Fix `docs/NAMESPACE.md` (and mirror the same membership in `docs/INTEGRATION.md §3` by hand) until green. Re-run until PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/dev/validate.mjs docs/NAMESPACE.md docs/INTEGRATION.md
git commit -m "feat: assert NAMESPACE/INTEGRATION tier tables match agent metadata (no prose drift)"
```

### Task A4: `contract` subcommand + `wicked.contract.published` event

**Files:**
- Modify: `install.mjs` (add `contract` subcommand)
- Modify: `lib/bus-emit.mjs` (catalog comment)
- Modify: `scripts/dev/sync-plugin-version.mjs` (emit on write)
- Modify: `docs/INTEGRATION.md §4` (document the event)
- Test: `node --test` smoke

- [ ] **Step 1: Add the `contract` subcommand to `install.mjs`**

Find the subcommand dispatch in `install.mjs` (where `status`/`doctor`/`version`/`check` are routed). Add a `contract` case that prints the published contract from `plugin.json`:

```javascript
// inside the subcommand switch/dispatch:
if (cmd === "contract") {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const plugin = JSON.parse(readFileSync(join(here, ".claude-plugin", "plugin.json"), "utf8"));
  const out = {
    version: plugin.version,
    agents: (plugin.agents || []).map(a => ({ subagent_type: `wicked-testing:${a.name}`, tier: a.tier })),
  };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}
```

(Match `install.mjs`'s existing import style for `readFileSync`/`join`/`fileURLToPath`; they are likely already imported — reuse them.)

- [ ] **Step 2: Smoke-test the subcommand**

Run: `node install.mjs contract | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const c=JSON.parse(s);console.log('version',c.version,'agents',c.agents.length,'tier1',c.agents.filter(a=>a.tier===1).length)})"`
Expected: `version 0.x.x agents 41 tier1 16`.

- [ ] **Step 3: Register + emit the event (non-load-bearing)**

In `lib/bus-emit.mjs`, add to the catalog comment (after line 20): `*   wicked.contract.published`. Then in `scripts/dev/sync-plugin-version.mjs`, after the successful write (after line 124, non-`--check` path), emit it:

```javascript
import { emitBusEvent } from "../../lib/bus-emit.mjs";
// ... after writeFileSync(...) in the apply branch:
emitBusEvent("wicked.contract.published", {
  version: desired.version,
  agents: desired.agents.map(a => ({ subagent_type: `wicked-testing:${a.name}`, tier: a.tier })),
});
```

(`emitBusEvent` no-ops if the bus isn't installed — fire-and-forget, never blocks the build.)

- [ ] **Step 4: Document the event + run the gate**

Add `wicked.contract.published` with its payload shape to `docs/INTEGRATION.md §4`. Then:
Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add install.mjs lib/bus-emit.mjs scripts/dev/sync-plugin-version.mjs docs/INTEGRATION.md
git commit -m "feat: contract subcommand (npx wicked-testing contract --json) + wicked.contract.published event"
```

**Phase A complete:** wicked-testing now publishes its tier contract from a single metadata source. Capture `node install.mjs contract` output — Phase B's snapshot is seeded from it.

---

## Phase B — wicked-garden (the consumer) — ⚠️ DEFERRED to the wg-* sweep

> **Superseded (2026-06-10).** Investigation found garden's consumer (`wg-check.md §1b`) is **dead code** — it validates a `.claude-plugin/gate-policy.json` that does not exist, for a `gate_dispatch.py` that has been deleted; the only other references are a spec doc and a v7-era crew scenario. The fix is **deletion of the dead mirror** (`_wicked_testing_tier1.py` + `wg-check §1b` + `specialist.json`'s `tier1_agents`), not a resolver — and it belongs to the separate `wg-*` cleanup sweep, NOT this branch. The B1–B4 tasks below are retained for historical reference only and are **not executed**.

> Separate repo + branch: `cd ~/Projects/wicked-garden && git checkout -b feat/consume-tier-contract`. Gate: garden's `pytest`.

### Task B1: Replace the frozensets with a resolver

**Files:**
- Modify: `scripts/_wicked_testing_tier1.py`
- Test: `tests/test_wicked_testing_contract.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_wicked_testing_contract.py`:

```python
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import _wicked_testing_tier1 as wt

def test_derives_tier1_from_contract(monkeypatch):
    contract = {"version": "0.4.0", "agents": [
        {"subagent_type": "wicked-testing:semantic-reviewer", "tier": 1},
        {"subagent_type": "wicked-testing:chaos-test-engineer", "tier": 2},
    ]}
    monkeypatch.setattr(wt, "_fetch_contract", lambda: contract)
    wt.refresh()
    assert "wicked-testing:semantic-reviewer" in wt.TIER1_AGENTS
    assert "wicked-testing:chaos-test-engineer" in wt.TIER2_AGENTS
    assert wt.is_valid_wt_reviewer("wicked-testing:semantic-reviewer") is True
    assert wt.is_valid_wt_reviewer("wicked-testing:chaos-test-engineer") is False
    assert wt.is_valid_wt_reviewer("some-other:agent") is True  # non-wt passes through

def test_falls_back_to_snapshot_with_warning(monkeypatch, capsys):
    monkeypatch.setattr(wt, "_fetch_contract", lambda: None)  # npx failed
    wt.refresh()
    assert len(wt.TIER1_AGENTS) >= 1  # bundled snapshot populated it
    assert "wicked-testing" in capsys.readouterr().err.lower()  # warned

def test_validate_gate_policy_flags_non_tier1(monkeypatch):
    contract = {"version": "0.4.0", "agents": [
        {"subagent_type": "wicked-testing:semantic-reviewer", "tier": 1},
    ]}
    monkeypatch.setattr(wt, "_fetch_contract", lambda: contract); wt.refresh()
    gp = {"gates": {"build": {"final": {"reviewers": ["wicked-testing:not-a-tier1"]}}}}
    assert wt.validate_gate_policy(gp) == ["wicked-testing:not-a-tier1"]
```

- [ ] **Step 2: Run it; confirm it fails**

Run: `cd ~/Projects/wicked-garden && python3 -m pytest tests/test_wicked_testing_contract.py -v`
Expected: FAIL — `_wicked_testing_tier1` has no `_fetch_contract`/`refresh`.

- [ ] **Step 3: Rewrite `scripts/_wicked_testing_tier1.py` as a resolver**

Replace the file's body. Keep `is_valid_wt_reviewer` + `validate_gate_policy` signatures identical (callers in `wg-check.md` import them plus `TIER1_AGENTS`/`TIER2_AGENTS`):

```python
"""wicked-testing tier contract — resolved, not mirrored.

Source of truth is wicked-testing's `tier:` agent metadata, published via
`npx wicked-testing contract --json`. We derive TIER1/TIER2 from it, falling
back to the committed snapshot if wicked-testing isn't resolvable. Never
hardcodes agent names; never silently widens validity.
"""
import json, os, subprocess, sys
from pathlib import Path

_SNAPSHOT = Path(__file__).resolve().parents[1] / ".claude-plugin" / "wt-contract.snapshot.json"
_FETCH_CMD = ["npx", "wicked-testing", "contract", "--json"]
_FETCH_TIMEOUT_S = 5

TIER1_AGENTS: frozenset = frozenset()
TIER2_AGENTS: frozenset = frozenset()

def _fetch_contract():
    """Return the live contract dict, or None if wicked-testing isn't resolvable."""
    if os.environ.get("WG_SKIP_WICKED_TESTING_CHECK", "").strip() == "1":
        return None
    try:
        r = subprocess.run(_FETCH_CMD, capture_output=True, text=True, timeout=_FETCH_TIMEOUT_S)
        if r.returncode != 0 or not r.stdout.strip():
            return None
        return json.loads(r.stdout)
    except Exception:
        return None

def _load_snapshot():
    try:
        return json.loads(_SNAPSHOT.read_text(encoding="utf-8"))
    except Exception:
        return {"agents": []}

def refresh():
    """(Re)derive TIER1_AGENTS/TIER2_AGENTS from the live contract or snapshot."""
    global TIER1_AGENTS, TIER2_AGENTS
    contract = _fetch_contract()
    if contract is None:
        contract = _load_snapshot()
        print("[wicked-garden] wicked-testing contract not resolvable — using bundled "
              "snapshot. Run `npx wicked-testing contract --json` to verify.", file=sys.stderr)
    agents = contract.get("agents", [])
    TIER1_AGENTS = frozenset(a["subagent_type"] for a in agents if a.get("tier") == 1)
    TIER2_AGENTS = frozenset(a["subagent_type"] for a in agents if a.get("tier") == 2)

def is_valid_wt_reviewer(name: str) -> bool:
    if not name.startswith("wicked-testing:"):
        return True
    if not TIER1_AGENTS:
        refresh()
    return name in TIER1_AGENTS

def validate_gate_policy(gate_policy_dict: dict) -> list:
    if not TIER1_AGENTS:
        refresh()
    violations, seen = [], set()
    for _gate, tiers in (gate_policy_dict.get("gates", {}) or {}).items():
        if not isinstance(tiers, dict):
            continue
        for _tier, config in tiers.items():
            if not isinstance(config, dict):
                continue
            candidates = list(config.get("reviewers", []))
            if config.get("fallback"):
                candidates.append(config["fallback"])
            for reviewer in candidates:
                if not isinstance(reviewer, str):
                    continue
                bad = (reviewer.startswith("wicked-testing:") and reviewer not in TIER1_AGENTS)
                legacy = reviewer == "qe-evaluator" or reviewer.startswith("wicked-garden:qe:")
                if (bad or legacy) and reviewer not in seen:
                    seen.add(reviewer); violations.append(reviewer)
    return violations

# Populate at import so existing `from _wicked_testing_tier1 import TIER1_AGENTS` callers work.
refresh()
```

- [ ] **Step 4: Run the tests; confirm pass**

Run: `cd ~/Projects/wicked-garden && python3 -m pytest tests/test_wicked_testing_contract.py -v`
Expected: PASS (3 tests). (Requires Step B2's snapshot for the fallback test — if running B1 before B2, create a minimal `.claude-plugin/wt-contract.snapshot.json` with `{"agents":[{"subagent_type":"wicked-testing:semantic-reviewer","tier":1}]}` first.)

- [ ] **Step 5: Commit**

```bash
git add scripts/_wicked_testing_tier1.py tests/test_wicked_testing_contract.py
git commit -m "feat: resolve wicked-testing tier contract via npx (no hardcoded mirror)"
```

### Task B2: Bundled snapshot + consistency check

**Files:**
- Create: `.claude-plugin/wt-contract.snapshot.json`
- Create/modify: a garden CI step (or `scripts/` check)

- [ ] **Step 1: Seed the snapshot from the live contract**

```bash
cd ~/Projects/wicked-garden
npx wicked-testing contract --json | python3 -m json.tool > .claude-plugin/wt-contract.snapshot.json
cat .claude-plugin/wt-contract.snapshot.json | python3 -c "import json,sys;d=json.load(sys.stdin);print('snapshot agents:',len(d['agents']),'tier1:',sum(1 for a in d['agents'] if a['tier']==1))"
```
Expected: `snapshot agents: 41 tier1: 16`.

- [ ] **Step 2: Add a consistency check**

Create `scripts/check_wt_snapshot.py`:

```python
#!/usr/bin/env python3
"""Fail if the bundled wt-contract snapshot drifts from the live contract."""
import json, subprocess, sys
from pathlib import Path
snap = json.loads((Path(__file__).resolve().parents[1] / ".claude-plugin" / "wt-contract.snapshot.json").read_text())
try:
    live = json.loads(subprocess.run(["npx","wicked-testing","contract","--json"],
                                     capture_output=True, text=True, timeout=5).stdout)
except Exception as e:
    print(f"SKIP: wicked-testing not resolvable ({e})"); sys.exit(0)  # can't check offline; not a failure
def norm(c): return sorted((a["subagent_type"], a["tier"]) for a in c["agents"])
if norm(snap) != norm(live):
    print("ERROR: wt-contract.snapshot.json drifted from live contract — re-seed it."); sys.exit(1)
print("OK: snapshot matches live contract")
```

Run: `python3 scripts/check_wt_snapshot.py`
Expected: `OK: snapshot matches live contract`. Wire it into garden's existing CI lint step (where `wg-check`/validators run).

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/wt-contract.snapshot.json scripts/check_wt_snapshot.py
git commit -m "feat: bundled wt-contract snapshot + drift check (gate-safe fallback)"
```

### Task B3: Drop the `specialist.json` mirror

**Files:**
- Modify: `.claude-plugin/specialist.json`

- [ ] **Step 1: Remove the duplicated list**

Delete the `tier1_agents` array from the `qe` object in `.claude-plugin/specialist.json` (lines ~27-39). Any consumer that needs the tier-1 set imports it from `_wicked_testing_tier1` instead.

```bash
grep -rln "specialist.json" ~/Projects/wicked-garden/scripts ~/Projects/wicked-garden/.claude 2>/dev/null | grep -v worktrees
```
For each hit that reads `tier1_agents` from specialist.json, repoint it to `from _wicked_testing_tier1 import TIER1_AGENTS`.

- [ ] **Step 2: Verify + commit**

Run: `python3 -c "import json; d=json.load(open('.claude-plugin/specialist.json')); assert 'tier1_agents' not in d.get('qe',{}); print('mirror removed')"`
Expected: `mirror removed`.

```bash
git add .claude-plugin/specialist.json
git commit -m "refactor: drop specialist.json tier1_agents mirror (derive from resolver)"
```

### Task B4: Fix the stale `run` command reference

**Files:**
- Modify: `scripts/sentinel/invariants.py:274`

- [ ] **Step 1: Repoint `run` → `execution`**

In `scripts/sentinel/invariants.py` line ~274, change the `wicked-testing:run` reference to `wicked-testing:execution` (a 0.4.0 command removal). Verify no other live refs:

```bash
grep -rn "wicked-testing:run\b" ~/Projects/wicked-garden --include=*.py | grep -v worktrees
```
Expected after fix: no matches.

- [ ] **Step 2: Commit**

```bash
git add scripts/sentinel/invariants.py
git commit -m "fix: wicked-testing:run -> :execution (0.4.0 command removal)"
```

**Phase B complete:** garden derives the contract; zero hardcoded testing names remain.

---

## Phase C — Agent roster trim (now a free local change)

> With garden's tier mirror confirmed dead, cutting an agent no longer breaks a live consumer. Net 41 → 40: cut `continuous-quality-monitor` (thinnest Tier-1, advisory-only, 1 dispatch ref), folding its unique build-phase signals into `code-analyzer` (which keeps its distinct post-code static-quality niche). Runs AFTER Phase A so the sync/validate machinery enforces consistency.

### Task C1: Cut `continuous-quality-monitor`, fold signals into `code-analyzer`

**Files:**
- Modify: `agents/code-analyzer.md`
- Delete: `agents/continuous-quality-monitor.md`, `evals/continuous-quality-monitor/`
- Modify: `skills/review/SKILL.md`, `docs/NAMESPACE.md`, `docs/INTEGRATION.md`
- Regenerate: `.claude-plugin/plugin.json`

- [ ] **Step 1: Preserve the unique signal.** Read `agents/continuous-quality-monitor.md`; fold its genuinely-unique build-phase coaching signals (lint / static-analysis / coverage-delta during an active build) into `agents/code-analyzer.md` as a short "Build-phase signals" subsection, so nothing is lost.
- [ ] **Step 2: Delete the agent + its eval set.**
```bash
git rm agents/continuous-quality-monitor.md && git rm -r evals/continuous-quality-monitor
```
- [ ] **Step 3: Remove the dispatch row.** In `skills/review/SKILL.md`, delete the `| Active build, quality signals | wicked-testing:continuous-quality-monitor |` row and the `agents/continuous-quality-monitor.md` entry in its references list.
- [ ] **Step 4: Update the tier docs.** Remove `continuous-quality-monitor` from the Tier-1 section of `docs/NAMESPACE.md` and `docs/INTEGRATION.md §3`.
- [ ] **Step 5: Regenerate + gate.**
```bash
node scripts/dev/sync-plugin-version.mjs    # agents 41 -> 40
npm test                                     # validate: 40 agents tiered, NAMESPACE matches
node scripts/dev/evals.mjs check-all
```
Expected: all green; `plugin.json` agents=40, tier1=15.
- [ ] **Step 6: Commit.**
```bash
git add -A
git commit -m "refactor!: cut continuous-quality-monitor (fold signals into code-analyzer); roster 41->40"
```

## Phase D — sqlite rebuild nudge

> Real-library test (cognitive_iq) found: on a newer Node, `better-sqlite3`'s prebuilt binary mismatches (NODE_MODULE_VERSION) and the store silently degrades to JSON-only — `insight`'s SQLite queries then fail with no guidance. Add an actionable nudge. Independent of the contract work.

### Task D1: Actionable better-sqlite3 ABI-mismatch guidance

**Files:**
- Modify: `lib/domain-store.mjs` (degradation message)
- Modify: `install.mjs` (`doctor`)

- [ ] **Step 1: Improve the degradation message.** In `lib/domain-store.mjs`, find the `better-sqlite3` load-failure catch (the JSON-only degradation path). When the caught error matches `/NODE_MODULE_VERSION|compiled against a different Node|ERR_DLOPEN/i`, append to the existing stderr warning: `Run \`npm rebuild better-sqlite3\` to restore the SQLite index (oracle/insight queries need it).`
- [ ] **Step 2: Add a doctor check.** In `install.mjs` `doctor`, attempt to load `better-sqlite3`; on ABI mismatch print `better-sqlite3: ABI mismatch — run \`npm rebuild better-sqlite3\``; on success print `better-sqlite3: ok`. Keep it non-fatal.
- [ ] **Step 3: Smoke + gate.**
```bash
node install.mjs doctor   # shows the better-sqlite3 status line
npm test
```
- [ ] **Step 4: Commit.**
```bash
git add lib/domain-store.mjs install.mjs
git commit -m "fix: actionable better-sqlite3 ABI-mismatch nudge (silent JSON-only degradation otherwise)"
```

## Self-Review

**1. Spec coverage:**
- §3 interface (`plugin.json` `agents[].tier`) → A2. ✓
- §4 publisher (frontmatter tier / validate / bake / docs assert / bus event) → A1, A2, A3, A4. ✓
- §5 consumer (resolver / fallback+CI / drop specialist.json / fix run) → B1, B2, B3, B4. ✓ (Refinement: consumption via `contract` subcommand, flagged in Architecture — within the spec's "npx resolution" path.)
- §7 degradation (missing tier → validate fails A1; unresolvable → snapshot+warn B1; drift → check B2; bus optional A4). ✓
- §8 testing (validate assertions A1/A3; sync --check A2; resolver pytest B1; snapshot check B2). ✓
- §9 sequencing (Phase A before B; B2 snapshot seeded from A's `contract` output). ✓

**2. Placeholder scan:** No TBD/TODO. The B1 fallback test notes the snapshot dependency explicitly (create a minimal one if running B1 first). The one judgment step (A3 doc fixes) shows the exact failing-then-fix loop, not "fix the docs."

**3. Type/name consistency:** `tier` is a number (1/2) in `plugin.json`/contract JSON and the `"1"`/`"2"` string in frontmatter (parser returns strings) — handled distinctly (validate compares `"1"`/`"2"`; sync's `tierOf` returns `Number`; resolver compares `== 1`). `TIER1_AGENTS`/`TIER2_AGENTS`/`is_valid_wt_reviewer`/`validate_gate_policy` names preserved exactly for `wg-check.md`'s imports. `_fetch_contract`/`refresh` consistent between the test and the module.

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-06-10-tier-contract-decoupling.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks. Fits: Phase A tasks are sequential (each `npm test`-gated), Phase B is a separate repo/branch.
2. **Inline Execution** — execute in this session via `executing-plans`, batched with checkpoints.

Which approach?
