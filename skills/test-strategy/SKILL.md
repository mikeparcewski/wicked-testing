---
name: wicked-testing:test-strategy
description: |
  Plan what and how to test. Generate comprehensive test strategies with coverage analysis,
  risk assessment, and scenario pairing. Writes strategy records to the DomainStore.

  Use when: "test strategy", "what should I test", "test plan", "coverage strategy",
  "generate test strategy", "how do I test this", "shift-left testing",
  "risk assessment for testing", "/wicked-testing:plan"
---

# Test Strategy Skill

Quality Engineering starts with a strategy. Before writing a single test, you need to know what to test, why, and in what order. This skill generates shift-left test strategies anchored to the actual codebase.

## Core Philosophy

> Test everything. Test it directly. Test both sides.

Every feature gets tested. Every test has both a positive case (expected behavior works) and a negative case (invalid/error conditions handled). Effort scales to match actual scope — a 3-line fix gets focused scenarios, a new feature gets exhaustive coverage.

## What This Skill Produces

1. A structured test strategy document covering:
   - Change type classification (UI, API, both, data, config)
   - Coverage categories and mandatory test types
   - Positive + negative scenario pairs
   - Risk areas and confidence levels
2. A strategy record written to the DomainStore (`strategies` table)

## Command

```
/wicked-testing:plan [target] [--project <name>] [--json]
```

- `target` — file path, directory, or feature description to analyze
- `--project` — associate strategy with this project name (creates project if needed)
- `--json` — emit JSON envelope instead of markdown

## Instructions

### 1. Identify the Target

Read the target (file, directory, or feature description). If no target is given, analyze the current project.

### 2. Classify Change Type

Determine: UI, API, both, data, or config. This drives which test categories are mandatory.

| Change Type | Mandatory Test Categories |
|-------------|--------------------------|
| UI | Feature completeness, JS errors, interactions, accessibility, visual |
| API | Endpoint correctness, status codes, request validation, auth/authz |
| Both | All UI + all API categories |
| Data | Schema validation, migrations, state transitions, backward compat |
| Config | Startup, env vars, feature flags, wiring |

### 3. Analyze Surface Area

Read and understand the code:
- All public functions, methods, endpoints
- Every input/output contract
- Error handling paths (and paths that should handle errors but don't)
- Dependencies and integration points

### 4. Generate Scenario Pairs

**MANDATORY: Every scenario must have a positive AND a negative counterpart.**

| Category | Positive | Negative |
|----------|----------|----------|
| Happy path | Primary use case works end-to-end | Invalid inputs rejected with proper errors |
| Error cases | Error handling activates correctly | Malformed payloads don't crash the system |
| Edge cases | Boundary values handled | Beyond-boundary inputs caught |
| Security | Auth works for valid users | Unauthorized access blocked |

### 5. Write Strategy to DomainStore

Ensure a project record exists, then write the strategy:

```javascript
// Pseudocode — the agent executes this via DomainStore
const store = createDomainStore({ root: '.wicked-testing' });
const project = store.create('projects', { name: projectName, description: '...' });
const strategy = store.create('strategies', {
  project_id: project.id,
  name: strategyName,
  body: strategyMarkdown
});
```

All writes go through the DomainStore (dual-write: JSON + SQLite). Never write domain records via ad-hoc file I/O.

### 6. Output

**Without `--json`** — Return a markdown strategy document:

```markdown
## Test Strategy: {target}

**Project**: {name}
**Change Type**: {ui|api|both|data|config}
**Scope**: {small|medium|large}
**Confidence**: {HIGH|MEDIUM|LOW}

### Scenario Pairs

| ID | Category | Positive | Negative | Priority |
|----|----------|----------|----------|----------|
| S1 | Happy | {desc} | {desc} | P1 |
| S2 | Error | {desc} | {desc} | P1 |

### Risk Areas
{Areas needing special attention}

### Recommendation
{What to prioritize}

*Strategy ID: {store_id} | Written to .wicked-testing/strategies/*
```

**With `--json`** — Use `scripts/_python.sh` to emit the JSON envelope:

```bash
python3 -c "import json,sys; sys.stdout.write(json.dumps({'ok': True, 'data': {...}, 'meta': {'command': 'wicked-testing:plan', 'duration_ms': 0, 'store_mode': 'sqlite+json'}}))" 2>/dev/null || python -c "..."
```

## Integration

- Feeds into `/wicked-testing:scenarios` (scenario authoring uses the strategy as input)
- Referenced by `/wicked-testing:acceptance` (test plans are scoped to the strategy)
- Visible via `/wicked-testing:oracle "what is the strategy for project X?"`
