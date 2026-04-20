---
description: Generate a test strategy for a feature or codebase — dispatches test-strategist agent
argument-hint: "[target] [--project <name>] [--json]"
---

# /wicked-testing:plan

Generate a shift-left test strategy. Analyzes your code or feature description and produces comprehensive scenario pairs (positive + negative) with coverage analysis.

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

### 2. Dispatch test-strategist

Invoke the `test-strategist` agent with the target context:

```
Task(
  subagent_type="wicked-testing:test-strategist",
  prompt="""Generate a comprehensive test strategy.

## Target
{target or current directory}

## Instructions
1. Classify the change type (UI, API, both, data, config)
2. Analyze the surface area (all public APIs, functions, endpoints)
3. Generate positive + negative scenario pairs for every feature
4. Identify risk areas and confidence level
5. Return findings in the standard test-strategist format.

**MANDATORY**: Every scenario must have BOTH positive AND negative counterpart.
"""
)
```

### 3. Write Strategy to DomainStore

After the agent returns findings, write the strategy record:

```javascript
// Agent writes via DomainStore — all writes go through the store
store.create('strategies', {
  project_id: projectId,
  name: strategyName,
  body: strategyMarkdown
});
```

### 4. Output

Without `--json` — Return the strategy document from the agent.

With `--json` — Emit the JSON envelope:

```bash
python3 -c "import json,sys; sys.stdout.write(json.dumps({'ok': True, 'data': {'strategy_id': '...', 'scenario_count': N, 'project': '...'}, 'meta': {'command': 'wicked-testing:plan', 'duration_ms': 0, 'schema_version': 1, 'store_mode': '...'}}))" 2>/dev/null || python -c "..."
```
