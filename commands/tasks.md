---
description: List, create, and update testing team tasks tracked in the DomainStore
argument-hint: "[list|create|update] [--project <name>] [--title <title>] [--status <status>] [--json]"
---

# /wicked-testing:tasks

Mini-kanban for the testing team's own work items. Not a general-purpose kanban — scoped to testing tasks only.

## Usage

```
# List all open tasks
/wicked-testing:tasks

# List with filter
/wicked-testing:tasks --status in_progress
/wicked-testing:tasks --project auth-service

# Create a task
/wicked-testing:tasks create --title "Investigate flaky checkout test" --project checkout-regression

# Update a task
/wicked-testing:tasks update <task-id> --status in_progress

# With JSON output
/wicked-testing:tasks --json
/wicked-testing:tasks create --title "..." --json
```

## Allowed Status Values

`open` | `in_progress` | `done` | `blocked`

## Instructions

### 1. Check SQLite Availability

Tasks require SQLite for state tracking. If unavailable:

```bash
python3 -c "import json,sys; sys.stdout.write(json.dumps({'ok': False, 'error': 'Tasks require SQLite index. Run /wicked-testing:setup to repair.', 'code': 'ERR_SQLITE_UNAVAILABLE', 'meta': {'command': 'wicked-testing:tasks', 'store_mode': 'json-only'}}))" 2>/dev/null || python -c "..."
```

### 2. Parse Subcommand

- No subcommand → list tasks
- `create` → create new task
- `update <id>` → update task status

### 3. List Tasks

Query DomainStore for tasks (SQLite):

```bash
sqlite3 -markdown ".wicked-testing/wicked-testing.db" "
  SELECT t.id, t.title, t.status, t.assignee_skill,
         p.name as project, t.updated_at
  FROM tasks t
  JOIN projects p ON t.project_id = p.id
  WHERE t.deleted = 0
    {STATUS_FILTER}
    {PROJECT_FILTER}
  ORDER BY t.updated_at DESC
"
```

**Output table**:

```markdown
## Tasks

| ID | Title | Status | Assignee Skill | Project | Updated |
|----|-------|--------|---------------|---------|---------|
| {short-id} | {title} | open | scenario-authoring | auth-service | 2026-04-10 |
```

### 4. Create Task

Validate required fields: `--title` and `--project`.
Determine project ID from project name.
Write task record to DomainStore with status `open`.

**Confirm**:
```markdown
Task created: {id}
Title: {title}
Project: {project}
Status: open
```

### 5. Update Task

Validate task ID exists. Validate new status is one of: `open`, `in_progress`, `done`, `blocked`.

Update DomainStore record. Update `updated_at` timestamp.

**Confirm**:
```markdown
Task updated: {id}
Status: {old_status} → {new_status}
```

If task not found: return `ERR_TASK_NOT_FOUND`.

### 6. Output

Without `--json` — Markdown output as above.

With `--json` — Emit the JSON envelope:

```bash
python3 -c "import json,sys; sys.stdout.write(json.dumps({'ok': True, 'data': {'tasks': [...], 'count': N}, 'meta': {'command': 'wicked-testing:tasks', 'duration_ms': 0, 'schema_version': 1, 'store_mode': 'sqlite+json'}}))" 2>/dev/null || python -c "..."
```
