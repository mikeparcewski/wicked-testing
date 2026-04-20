---
name: test-runner-self-test
description: |
  Bootstrap self-test scenario for wicked-testing. Validates that the plugin can initialize
  its own domain store, run a scenario, and query the results via the oracle.
  This is the dogfood proof: wicked-testing uses itself to validate itself.
version: "1.0"
category: cli
tags: [bootstrap, self-test, dogfood]
tools:
  required: [node]
  optional: [sqlite3]
timeout: 120
assertions:
  - id: A1
    description: /wicked-testing:stats returns valid JSON with ok=true
  - id: A2
    description: Stats response contains row counts for all 7 tables
  - id: A3
    description: Store mode is reported (sqlite+json or json-only)
  - id: A4
    description: Schema version is 1
---

# Test Runner Self-Test

Bootstrap dogfood scenario — wicked-testing validates itself.

## Setup

```bash
# Ensure we have a clean .wicked-testing directory for the self-test
mkdir -p .wicked-testing
echo "Setup: .wicked-testing directory ready"
```

## Steps

### Step 1: Verify Node.js is available (node)

```bash
node --version
```

**Expect**: Exit code 0, Node.js version >= 18

### Step 2: Verify domain-store.mjs exists and is readable (node)

```bash
node -e "import('./lib/domain-store.mjs').then(m => console.log('DomainStore loaded:', typeof m.DomainStore)).catch(e => { console.error('FAIL:', e.message); process.exit(1); })"
```

**Expect**: Exit code 0, "DomainStore loaded: function"

### Step 3: Verify oracle-queries.mjs exports the query library (node)

```bash
node -e "import('./lib/oracle-queries.mjs').then(m => { console.log('Queries:', Object.keys(m.QUERIES).length); if (Object.keys(m.QUERIES).length < 12) { console.error('FAIL: expected 12+ queries'); process.exit(1); } }).catch(e => { console.error('FAIL:', e.message); process.exit(1); })"
```

**Expect**: Exit code 0, "Queries: 12" (or more)

### Step 4: Create a project in the domain store (node)

```bash
node -e "
import('./lib/domain-store.mjs').then(({ DomainStore }) => {
  const store = new DomainStore('.wicked-testing');
  const project = store.create('projects', {
    name: 'wicked-testing-self-test',
    description: 'Bootstrap dogfood project'
  });
  console.log('Project created:', project.id, project.name);
  store.close();
}).catch(e => { console.error('FAIL:', e.message); process.exit(1); });
"
```

**Expect**: Exit code 0, "Project created: {uuid} wicked-testing-self-test"

### Step 5: Create a scenario record in the domain store (node)

```bash
node -e "
import('./lib/domain-store.mjs').then(({ DomainStore }) => {
  const store = new DomainStore('.wicked-testing');
  const projects = store.list('projects', { name: 'wicked-testing-self-test' });
  if (!projects.length) { console.error('FAIL: project not found'); process.exit(1); }
  const scenario = store.create('scenarios', {
    project_id: projects[0].id,
    name: 'test-runner-self-test',
    format_version: '1.0',
    body: 'Bootstrap self-test scenario',
    source_path: 'scenarios/test-runner.md'
  });
  console.log('Scenario created:', scenario.id, scenario.name);
  store.close();
}).catch(e => { console.error('FAIL:', e.message); process.exit(1); });
"
```

**Expect**: Exit code 0, "Scenario created: {uuid} test-runner-self-test"

### Step 6: Create a run and verdict record (node)

```bash
node -e "
import('./lib/domain-store.mjs').then(({ DomainStore }) => {
  const store = new DomainStore('.wicked-testing');
  const projects = store.list('projects', { name: 'wicked-testing-self-test' });
  const scenarios = store.list('scenarios', { name: 'test-runner-self-test' });
  if (!projects.length || !scenarios.length) {
    console.error('FAIL: missing records');
    process.exit(1);
  }
  const now = new Date().toISOString();
  const run = store.create('runs', {
    project_id: projects[0].id,
    scenario_id: scenarios[0].id,
    started_at: now,
    status: 'running'
  });
  store.update('runs', run.id, {
    finished_at: new Date().toISOString(),
    status: 'passed',
    evidence_path: '.wicked-testing/runs/bootstrap'
  });
  const verdict = store.create('verdicts', {
    run_id: run.id,
    verdict: 'PASS',
    evidence_path: '.wicked-testing/runs/bootstrap',
    reviewer: 'acceptance-test-reviewer',
    reason: 'Bootstrap self-test passed'
  });
  console.log('Run created:', run.id);
  console.log('Verdict created:', verdict.id, verdict.verdict);
  store.close();
}).catch(e => { console.error('FAIL:', e.message); process.exit(1); });
"
```

**Expect**: Exit code 0, "Verdict created: {uuid} PASS"

### Step 6b: Create a task record (node)

```bash
node -e "
import('./lib/domain-store.mjs').then(({ DomainStore }) => {
  const store = new DomainStore('.wicked-testing');
  const projects = store.list('projects', { name: 'wicked-testing-self-test' });
  if (!projects.length) { console.error('FAIL: project not found'); process.exit(1); }
  const task = store.create('tasks', {
    project_id: projects[0].id,
    title: 'Bootstrap self-test verification',
    body: 'Verify wicked-testing can track its own work',
    status: 'done',
    assignee_skill: 'test-runner'
  });
  console.log('Task created:', task.id, task.title);
  store.close();
}).catch(e => { console.error('FAIL:', e.message); process.exit(1); });
"
```

**Expect**: Exit code 0, "Task created: {uuid} Bootstrap self-test verification"

### Step 7: Verify all 7 tables have at least one row (node)

```bash
node -e "
import('./lib/domain-store.mjs').then(({ DomainStore }) => {
  const store = new DomainStore('.wicked-testing');
  const stats = store.stats();
  console.log(JSON.stringify(stats));
  const required = ['projects', 'scenarios', 'runs', 'verdicts', 'tasks'];
  for (const table of required) {
    if (!stats.counts[table] || stats.counts[table] < 1) {
      console.error('FAIL: ' + table + ' has 0 rows');
      process.exit(1);
    }
  }
  console.log('All required tables populated');
  console.log('Store mode:', stats.mode);
  store.close();
}).catch(e => { console.error('FAIL:', e.message); process.exit(1); });
"
```

**Expect**: Exit code 0, "All required tables populated" (including tasks), store mode reported

### Step 8: Query via oracle-queries routing (node)

```bash
node -e "
import('./lib/oracle-queries.mjs').then(({ routeQuestion, QUERIES }) => {
  const tests = [
    ['what scenarios exist for the self-test project?', 'scenarios_for_project'],
    ['what was the last verdict for test-runner?', 'last_verdict_for_scenario'],
    ['what tasks are in progress?', 'tasks_by_status'],
    ['show bootstrap verdict', 'last_verdict_for_scenario'],
  ];
  let failed = false;
  for (const [question, expected] of tests) {
    const got = routeQuestion(question, {});
    if (got !== expected) {
      console.error('ROUTING FAIL:', question, '->', got, '(expected', expected + ')');
      failed = true;
    } else {
      console.log('OK:', question, '->', got);
    }
  }
  if (failed) process.exit(1);
}).catch(e => { console.error('FAIL:', e.message); process.exit(1); });
"
```

**Expect**: Exit code 0, all routing tests pass

## Cleanup

```bash
echo "Self-test complete. .wicked-testing/ directory retained for oracle verification."
echo "Run: /wicked-testing:oracle 'show bootstrap verdict' to confirm end-to-end."
```
