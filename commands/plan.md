---
description: Generate a test strategy — dispatches the plan skill's 4-way router (strategist / risk / testability / AC-quality)
argument-hint: "[target] [--project <name>] [--json]"
---

# /wicked-testing:plan

Generate a shift-left test strategy. Routes through the `wicked-testing:plan`
skill's 4-way dispatch (strategist / risk-assessor / testability-reviewer /
requirements-quality-analyst) based on what the target looks like — so ACs
get AC-quality review, designs get testability review, features get strategy,
etc.

## Usage

```
/wicked-testing:plan [target] [--project <name>] [--json]
```

- `target` — file path, directory, or feature description (optional; defaults to current dir)
- `--project <name>` — associate strategy with this project
- `--json` — emit JSON envelope

## Instructions

### 1. Check Config

Verify `.wicked-testing/config.json` exists. If not:

```
Config not found. Run /wicked-testing:setup first.
Code: ERR_NO_CONFIG
```

### 2. Invoke the `wicked-testing:plan` skill

The skill reads the target and routes to the correct planning agent (see
[`skills/plan/SKILL.md`](../skills/plan/SKILL.md)):

- Acceptance criteria / clarify doc → `requirements-quality-analyst`
- Design doc / architecture sketch → `testability-reviewer`
- Feature description / user story → `test-strategist`
- Known-risky change (security, data, perf) → `risk-assessor`
- "Test everything" / broad review → all four in parallel

Invoking the skill lets its dispatch logic run. Calling `test-strategist`
directly would bypass the 4-way router (wave-6 audit fix #63).

### 3. Strategy record

The strategy is written to DomainStore by the dispatched agent via
`store.create('strategies', {...})`, which also fires
`wicked.teststrategy.authored` on the bus when present.

### 4. Output

Without `--json` — return the strategy document from the dispatched agent.

With `--json` — emit the JSON envelope:

```bash
python3 -c "import json,sys; sys.stdout.write(json.dumps({'ok': True, 'data': {'strategy_id': '...', 'scenario_count': N, 'project': '...'}, 'meta': {'command': 'wicked-testing:plan', 'duration_ms': 0, 'schema_version': 1, 'store_mode': '...'}}))" 2>/dev/null || python -c "import json,sys; sys.stdout.write(json.dumps({'ok': True, 'data': {'strategy_id': '...', 'scenario_count': N, 'project': '...'}, 'meta': {'command': 'wicked-testing:plan', 'duration_ms': 0, 'schema_version': 1, 'store_mode': '...'}}))"
```

## References

- [Plan skill](../skills/plan/SKILL.md) — dispatch logic + Tier-2 routing
- [Integration contract](../docs/INTEGRATION.md)
