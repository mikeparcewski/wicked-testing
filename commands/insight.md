---
description: Query the ledger — stats, reports, flake detection, coverage gaps
argument-hint: "[question] [--project <name>] [--json]"
---

# /wicked-testing:insight

Read-only lens on the wicked-testing ledger. Built on the fixed-SQL oracle —
no LLM-generated SQL, every answer is auditable.

## Usage

```
/wicked-testing:insight "<question>" [--project <name>] [--json]
```

## Example questions

- "Has scenario X passed in the last 24 hours?"
- "What's the flake rate for the auth suite?"
- "Show me the last 10 runs of login-with-bad-creds"
- "Which scenarios haven't run in a month?"
- "Which code paths are still untested?"

## Instructions

Invoke the **wicked-testing:insight** skill. It dispatches to `test-oracle`
which keyword-matches your question to one of the named parameterized
queries. If no match, the oracle returns the supported question list —
it never guesses SQL.

Output: a JSON answer or markdown table + the query name used (so the
reader can audit).

This command **does not mutate** state and **does not emit bus events**.

## Modes (absorbed in 0.4.0)

`insight` is the single read-only door to the ledger. What used to be separate
commands are now questions you ask it:

| Old command | Ask insight instead |
|-------------|---------------------|
| `stats`     | "domain health" / "row counts" / "schema version" — routes to the `row_counts`, `schema_version`, `recent_runs` oracle queries |
| `report`    | "generate a report for <project/scope>" — oracle rows rendered as a markdown summary |
| `oracle`    | any plain-language data question — this *is* the oracle; `insight` was always built on it |

Flags `--project`, `--status`, `--since`, `--json` are honored as before.

> **`tasks` is removed, not absorbed.** `insight` is read-only and will not
> create or mutate tasks. Existing task rows remain queryable here
> ("what tasks are open?", "tasks for <project>") via the `tasks_by_status`
> and `tasks_for_project` oracle queries. Task *creation/update* via a command
> is gone in 0.4.0 — use the `DomainStore` API (`lib/domain-store.mjs`) directly
> if a workflow needs it.

## References

- [Insight skill](../skills/insight/SKILL.md)
