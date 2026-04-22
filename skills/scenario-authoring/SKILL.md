---
name: wicked-testing:scenario-authoring
description: |
  Create and edit self-contained test scenario files in the wicked-testing scenario format.
  Writes scenario records to the DomainStore.

  Use when: "write scenarios", "create test scenarios", "scenario format",
  "add scenarios", "scenario authoring", "test case authoring",
  "document test steps", "/wicked-testing:scenarios"
---

# Scenario Authoring Skill

Write E2E test scenarios as self-contained markdown files that both humans and AI agents can execute and review. Every scenario is a complete specification of what to test and what success looks like.

## Scenario Format

See `SCENARIO-FORMAT.md` for the full format specification. In brief:

```yaml
---
name: my-scenario
description: What this scenario tests
version: "1.0"
category: api           # api|browser|perf|infra|security|a11y|cli
tags: [smoke, auth]
tools:
  required: [curl]
  optional: [hurl]
timeout: 120
assertions:
  - id: A1
    description: Response status is 200
  - id: A2
    description: Response body contains expected fields
---

## Setup (optional)

```bash
# Commands to run before steps
```

## Steps

### Step 1: {description} ({cli-name})

```bash
curl -sf https://example.com/api/health
```

**Expect**: Exit code 0, JSON response with `status: "ok"`

## Cleanup (optional)

```bash
# Always runs after steps, even on failure
```
```

## Command

```
/wicked-testing:scenarios [feature] [--project <name>] [--strategy <id>] [--json]
```

- `feature` — feature or codebase path to generate scenarios for
- `--project` — associate scenarios with this project
- `--strategy` — link scenarios to an existing strategy ID
- `--json` — emit JSON envelope

## Instructions

### 1. Understand the Feature Under Test

Read the feature description, code, or strategy. Identify:
- All user-visible behaviors
- All API endpoints or CLI commands
- Error conditions and edge cases
- Implicit preconditions

### 2. Generate Scenario Files

For each test case, create a scenario file in `scenarios/` following the format in `SCENARIO-FORMAT.md`:

- **Self-contained**: every scenario includes its own setup, steps, and cleanup
- **One behavior per scenario**: "User can log in" is one scenario, not "User can log in and view dashboard"
- **Exit code = pass/fail**: steps must exit 0 on success, non-zero on failure
- **Positive AND negative**: every feature gets both a positive and negative scenario pair
- **Fenced code blocks**: use `bash` for shell, `javascript` for k6, `hurl` for Hurl

### 3. Write Scenario Records to DomainStore

After creating scenario files, register them in the store:

```javascript
// Pseudocode
const store = createDomainStore({ root: '.wicked-testing' });
const scenario = store.create('scenarios', {
  project_id: projectId,
  strategy_id: strategyId,  // optional
  name: 'my-scenario',
  format_version: '1.0',
  body: scenarioFileContent,
  source_path: 'scenarios/my-scenario.md'
});
```

### 4. Validate Scenario Format

Before saving, verify each scenario:
- Has valid YAML frontmatter (name, description, version fields)
- Has at least one step
- Steps have fenced code blocks
- Required tools are documented
- Cleanup section exists if setup creates state

### 5. Output

**Without `--json`** — List created scenarios with summaries:

```markdown
## Scenarios Created: {feature}

| File | Category | Steps | Tools | Priority |
|------|----------|-------|-------|----------|
| scenarios/feature-positive.md | api | 3 | curl | P1 |
| scenarios/feature-negative.md | api | 2 | curl | P1 |

Run with: /wicked-testing:run scenarios/feature-positive.md
```

**With `--json`** — Use `scripts/_python.sh` Python pattern to emit the JSON envelope.

## Key Rules

1. **Exit code = pass/fail** — every step command must exit 0 for PASS
2. **One CLI per step** — identify it in the step header parenthetical `(curl)`
3. **Headless flags** — browser/a11y tools must include headless configuration
4. **Cleanup always runs** — even on failure, like a `finally` block
5. **Self-contained** — no external state dependencies between scenarios
6. **Documented assertions** — the `assertions:` frontmatter field maps to reviewer checkpoints

## Category-to-Tool Mapping

| Category | Tools | What to Test |
|----------|-------|-------------|
| api | curl, hurl | Health checks, contracts, response validation |
| browser | playwright, cypress | Page load, interactions, content verification |
| perf | k6, hey | Load testing, response time thresholds |
| infra | trivy | Container scanning, IaC security |
| security | semgrep | SAST, code security patterns |
| a11y | pa11y | WCAG compliance, accessibility issues |
| cli | bash | CLI command behavior, exit codes |

## Integration

- Scenarios feed into `/wicked-testing:run` (execution) and `/wicked-testing:acceptance` (3-agent pipeline)
- Linked to strategies via `strategy_id` in DomainStore
- Queryable via `/wicked-testing:oracle "what scenarios exist for project X?"`
