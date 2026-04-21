---
name: wicked-testing:insight
description: |
  Tier-1 orchestrator for reading the ledger. Stats, reports, flake detection,
  coverage gaps, historical queries. Never writes — only reads.

  Use when: "has this passed recently", "flake rate", "show me the last N
  runs", "coverage gaps", "generate a report", "stats", "exploratory session".
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
- "Run an exploratory charter on the new checkout flow."

## How it dispatches

| Input                                           | Dispatch                                     |
|-------------------------------------------------|----------------------------------------------|
| A question, natural language                    | `wicked-testing:test-oracle` (fixed SQL)     |
| "generate a report"                             | Report-generator flow via oracle + Tier-2    |
| "find flaky tests"                              | `wicked-testing:flaky-test-hunter`           |
| "find untested legacy code"                     | `wicked-testing:coverage-archaeologist`      |
| "run an exploratory session"                    | `wicked-testing:exploratory-tester`          |
| "audit production quality" / post-deploy read   | `wicked-testing:production-quality-engineer` |
| Unknown question                                | Oracle returns the supported question list   |

### Dispatch block (executable)

```
Task(
  subagent_type="wicked-testing:test-oracle",
  prompt="""Answer the question below against the wicked-testing ledger.

## Question
{natural-language question}

## Optional filters (from flags)
- project: {name or null}
- scenario: {name or null}
- since: {ISO date or null}

## Instructions
1. Route the question to a named query in lib/oracle-queries.mjs by keyword
   matching. NEVER synthesize SQL.
2. If no match, return the list of supported question patterns and exit —
   do not fabricate results.
3. If better-sqlite3 is unavailable, return ERR_SQLITE_UNAVAILABLE exactly.
4. Run the named query with bound parameters. Return rows as JSON or markdown
   table (per --json flag).
5. Include the query name used so the caller can audit.

Do NOT perform state mutations. Do NOT emit bus events."""
)
```

Swap `subagent_type` to the specialist when the trigger matches something the
oracle doesn't cover — flake detection, coverage archaeology, and exploratory
sessions all have dedicated agents.

## Tier-2 specialists this skill routes to

Insight is heavier on Tier-2 than other Tier-1 skills because most history
questions have a specialist answer:

| Trigger                                                  | Specialist                                  |
|----------------------------------------------------------|---------------------------------------------|
| Flake rate / quarantine proposal                         | `wicked-testing:flaky-test-hunter`          |
| Coverage gaps, dead-code detection                       | `wicked-testing:coverage-archaeologist`     |
| Charter-driven exploratory session                       | `wicked-testing:exploratory-tester`         |
| Post-deploy quality, canary read                         | `wicked-testing:production-quality-engineer` |
| Observability assertion audit (trace/log/metric coverage)| `wicked-testing:observability-test-engineer` |
| Contract drift report (historical / consumer-side)       | `wicked-testing:contract-testing-engineer`  |
| "Most impactful tests for HEAD" / TIA lookup             | `wicked-testing:test-impact-analyzer`       |
| "Should we ship v2.4.0?" / release readiness             | `wicked-testing:release-readiness-engineer` |
| "Any incident without a regression scenario yet?"        | `wicked-testing:incident-to-scenario-synthesizer` |

## Oracle safety

The oracle never generates SQL. It keyword-matches the question to one of the
named parameterized queries in [`lib/oracle-queries.mjs`](../../lib/oracle-queries.mjs).
If nothing matches, it returns the list of supported questions — it never
guesses. See also [`lib/domain-store.mjs`](../../lib/domain-store.mjs) for the
table-name allowlist that backs the CRUD layer.

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
