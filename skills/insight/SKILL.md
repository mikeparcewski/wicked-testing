---
name: wicked-testing:insight
description: |
  Tier-1 orchestrator for reading the ledger. Stats, reports, flake detection,
  coverage gaps, historical queries. Never writes — only reads.

  Use when: "has this passed recently", "flake rate", "show me the last N
  runs", "coverage gaps", "generate a report", "stats".
---

# wicked-testing:insight

The read-only lens on wicked-testing's ledger. Built on the fixed-SQL oracle
so answers are auditable, not LLM-guessed.

## When to use

- "Has scenario X passed in the last 24 hours?"
- "What's the flake rate for the auth suite?"
- "Give me a run report for PR #123"
- "Which scenarios haven't run in a month?"
- "Which code paths are still untested?"

## How it dispatches

| Input                                           | Dispatch                                     |
|-------------------------------------------------|----------------------------------------------|
| A question, natural language                    | `wicked-testing:test-oracle` (fixed SQL)     |
| "generate a report"                             | Report-generator flow (Tier-2)               |
| "find flaky tests"                              | Tier-2: flaky-test-hunter                    |
| "find untested legacy code"                     | Tier-2: coverage-archaeologist               |
| Unknown question                                | Oracle returns the supported question list   |

## Oracle safety

The oracle never generates SQL. It keyword-matches the question to one of the
named parameterized queries. If nothing matches, it returns the list of
supported questions — it never guesses.

## Output

- The answer (JSON or markdown table depending on caller)
- The query name used (so the reader can audit)
- A link to the ledger file if deeper inspection is warranted

This skill does not emit bus events — it is read-only and should not mutate
state.

## References

- [`docs/INTEGRATION.md`](../../docs/INTEGRATION.md)
- `agents/test-oracle.md`
- `lib/oracle-queries.mjs` (internal — query catalog)
