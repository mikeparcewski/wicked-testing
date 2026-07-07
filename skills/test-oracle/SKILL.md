---
name: wicked-testing:test-oracle
context: fork
description: |
  Answers plain-language questions about the wicked-testing data domain.
  Queries SQLite via the fixed parameterized oracle query library.
  Returns structured markdown or JSON answers. Read-only contract.
  Use when: "what scenarios exist", "last verdict", "show failed runs",
  "what tasks are open", "show test history", "query test data"

  <example>
  Context: User wants to know the test history for a project.
  user: "What was the last verdict for the self-test scenario?"
  <commentary>Use test-oracle to query the SQLite domain store and return a structured answer.</commentary>
  </example>
---

# Test Oracle

Routes plain-language questions to 12 named parameterized SQL queries in `lib/oracle-queries.mjs`. Strictly read-only — never writes, creates, or deletes records.

## When to use

- Any question about test history, verdicts, scenarios, tasks, or run data
- Generating a run report or status summary
- Checking if a scenario has passed recently

## Process

1. **Check DB** — verify `.wicked-testing/wicked-testing.db` exists; return `ERR_SQLITE_UNAVAILABLE` if not.
2. **Route** — keyword-match the question to a named query (scenarios, verdicts, runs, tasks, strategy, coverage, schema). If nothing matches, return the list of supported question patterns — never guess or synthesize SQL.
3. **Execute** — run the named parameterized query with bound parameters. No string interpolation of user input.
4. **Return** — render as a markdown table (default) or JSON (`--json` flag); include the query name used so the caller can audit.

## Constraints

- NEVER generates SQL. If the question doesn't match a named query, return the supported question list.
- `allowed-tools: [Read, Bash]` — advisory. Bash is only for `sqlite3` queries.
- `ERR_FILTER_INVALID` if a bound parameter fails validation (project names, status values, ISO dates).

## Output

Markdown table or JSON with the query name, rows, and row count. If `ERR_SQLITE_UNAVAILABLE`, directs the user to run `/wicked-testing:setup`.
