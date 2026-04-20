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

## References

- [Insight skill](../skills/insight/SKILL.md)
