---
description: Create and edit self-contained test scenario files in the wicked-testing scenario format
argument-hint: "[feature] [--project <name>] [--strategy <id>] [--json]"
---

# /wicked-testing:scenarios

Author wicked-testing scenario files. Creates self-contained `.md` scenario files in `scenarios/` and registers them in the DomainStore.

## Usage

```
/wicked-testing:scenarios [feature] [--project <name>] [--strategy <id>] [--json]
```

- `feature` — feature or codebase to generate scenarios for
- `--project <name>` — associate scenarios with this project
- `--strategy <id>` — link scenarios to an existing strategy ID
- `--json` — emit JSON envelope

## Instructions

### 1. Check Config

Verify `.wicked-testing/config.json` exists. If not, prompt to run `/wicked-testing:setup`.

### 2. Determine Context

If `feature` is provided, analyze it to understand what to test. If not provided, ask the user for the feature description or scenario type.

### 3. Create Scenario Files

Create scenario files in `scenarios/` following the format in `SCENARIO-FORMAT.md`. Every scenario must be:
- **Self-contained**: includes setup, steps, and cleanup
- **Exit-code driven**: step commands exit 0 for PASS, non-zero for FAIL
- **Documented**: assertions in frontmatter match step expectations

Minimum viable scenario structure:

```yaml
---
name: {scenario-name}
description: {what this tests}
version: "1.0"
category: {api|browser|perf|infra|security|a11y|cli}
tags: [{tag1}, {tag2}]
tools:
  required: [{tool}]
  optional: []
timeout: 120
assertions:
  - id: A1
    description: {what must be true}
---

## Steps

### Step 1: {description} ({cli-name})

```bash
{command}
```

**Expect**: {what success looks like}
```

### 4. Register in DomainStore

After creating files, register scenario records:

```javascript
store.create('scenarios', {
  project_id: projectId,
  strategy_id: strategyId,
  name: scenarioName,
  format_version: '1.0',
  body: fileContent,
  source_path: `scenarios/${filename}`
});
```

### 5. Output

Without `--json` — List created scenarios.

With `--json` — Emit the JSON envelope:

```bash
python3 -c "import json,sys; sys.stdout.write(json.dumps({'ok': True, 'data': {'created': [{...}], 'count': N}, 'meta': {'command': 'wicked-testing:scenarios', 'duration_ms': 0, 'schema_version': 1, 'store_mode': '...'}}))" 2>/dev/null || python -c "..."
```
