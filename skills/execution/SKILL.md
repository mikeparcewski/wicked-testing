---
name: wicked-testing:execution
description: |
  Tier-1 orchestrator for running tests and capturing evidence. Executes
  scenarios, invokes framework runners, collects artifacts, and writes the
  run + verdict to the ledger.

  Use when: "run the test", "execute this scenario", "run the suite",
  "acceptance test this", "capture evidence", "prove it works".
---

# wicked-testing:execution

The doer. Takes a scenario or test command, runs it, captures everything,
writes the ledger entry. Evidence lives under
`.wicked-testing/evidence/<run-id>/`.

## When to use

- You have a scenario ready and need a real run with evidence
- You want to run the existing test suite and record the verdict in the ledger
- You're in a crew test phase and need all scenarios executed

## How it dispatches

| Input                                                    | Dispatch                                                                                                 |
|----------------------------------------------------------|----------------------------------------------------------------------------------------------------------|
| A scenario file                                          | `wicked-testing:scenario-executor`                                                                       |
| Scenario + "give me a verdict" (acceptance-grade)        | Route to `/wicked-testing:acceptance` — the 3-agent isolated pipeline (writer → executor → reviewer).    |
| Scenario + "give me a verdict" (dev-loop, explicit)      | `wicked-testing:test-designer` ONLY if the caller explicitly asks for the fast-path / self-graded loop.  |
| Pre-written plan, "just execute"                         | `wicked-testing:acceptance-test-executor`                                                                |
| "run the suite" (no scenario)                            | Project's native runner; record result                                                                   |
| Contract verification                                    | `wicked-testing:contract-testing-engineer`                                                               |

**Default posture:** verdict requests go to the 3-agent pipeline. `test-designer`
is the dev-loop fast path with known self-grading risk; it is never the default
and never used for audit / CI / crew-phase sign-off evidence. See the warning
in `agents/test-designer.md`.

Tier-2 specialists by category (browser, load, a11y, visual) are invoked by
the scenario-executor based on scenario `category`.

## Evidence & ledger

- Every run produces a `run_id` (UUID v4)
- Artifacts land in `.wicked-testing/evidence/<run-id>/artifacts/`
- `manifest.json` is written per `docs/EVIDENCE.md`
- The run + verdict are written to the SQLite ledger
- Bus events emitted (when bus present): `wicked.testrun.started`,
  `wicked.testrun.finished`, `wicked.evidence.captured`, and finally
  `wicked.verdict.recorded`

## Output

- The run_id + path to `manifest.json`
- Verdict (PASS / FAIL / N-A / SKIP)
- One-line summary — never a wall of tool output

## References

- [`docs/INTEGRATION.md`](../../docs/INTEGRATION.md)
- [`docs/EVIDENCE.md`](../../docs/EVIDENCE.md)
- `agents/scenario-executor.md`, `agents/test-designer.md`,
  `agents/acceptance-test-executor.md`
