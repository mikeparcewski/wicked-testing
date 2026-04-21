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

### Dispatch block (executable)

```
Task(
  subagent_type="wicked-testing:scenario-executor",
  prompt="""Execute the scenario file at the path below and capture evidence.

## Scenario Path
{path to scenarios/<name>.md}

## Evidence Directory
.wicked-testing/evidence/{RUN_ID}/

## Instructions
1. Read the scenario via the Read tool.
2. For each step, run the command via Bash with the scenario's timeout
   (enforce via lib/exec-with-timeout.mjs when available — the shell
   fallback chain is `timeout || gtimeout || bare` with a warning log).
3. Capture stdout, stderr, exit code, wall-clock duration per step.
4. Write step-N.json + evidence.json + artifact files into EVIDENCE_DIR.
5. Determine per-step outcome: exit 0 = PASS, non-zero = FAIL, CLI missing = SKIPPED.

Do NOT self-grade qualitative outcomes. For acceptance-grade verdicts
route to /wicked-testing:acceptance instead."""
)
```

Swap `subagent_type` per the table above. For a scenario that also needs
contract verification, dispatch `scenario-executor` and
`contract-testing-engineer` in parallel and merge results.

## Tier-2 specialists this skill routes to

For specialized execution paths — chaos experiments, load generators, visual
baselines, etc. — dispatch the specialist. Each writes its own artifacts to
`EVIDENCE_DIR` and returns an evidence report the skill includes in the run
summary:

| Trigger                                                | Specialist                                  |
|--------------------------------------------------------|---------------------------------------------|
| Chaos experiment (Toxiproxy / Chaos Mesh / AWS FIS)    | `wicked-testing:chaos-test-engineer`        |
| Load / perf run (k6 / locust / hey)                    | `wicked-testing:load-performance-engineer`  |
| Visual regression run (Playwright + pixelmatch)        | `wicked-testing:visual-regression-engineer` |
| Full user-journey E2E (multi-context Playwright)       | `wicked-testing:e2e-orchestrator`           |
| Component run (RTL + user-event)                       | `wicked-testing:ui-component-test-engineer` |
| Integration run (real services via testcontainers)    | `wicked-testing:integration-test-engineer`  |
| Fuzz / property run (Hypothesis / fast-check / AFL++)  | `wicked-testing:fuzz-property-engineer`     |
| Security run (SAST scan / DAST scan / secrets check)   | `wicked-testing:security-test-engineer`     |
| AI-feature test (prompt-injection / eval harness)      | `wicked-testing:ai-feature-test-engineer`   |
| IaC validation run (terraform validate / opa / checkov)| `wicked-testing:iac-test-engineer`          |
| Compliance evidence collection (SOC2 / HIPAA controls) | `wicked-testing:compliance-test-engineer`   |
| Selective-execution — "which tests for this diff"      | `wicked-testing:test-impact-analyzer`       |

Chaos / load / security-DAST specialists MUST respect the scenario's `trust_level` frontmatter
field. Production-impacting runs require `trust_level: production-authorized`
AND a `change-ticket:` reference; otherwise the specialist refuses and records
SKIP with reason `trust-level-insufficient`.

## Evidence & ledger

- Every run produces a `run_id` (UUID v4 from DomainStore)
- Artifacts land in `.wicked-testing/evidence/<run-id>/`
- `manifest.json` is written per `docs/EVIDENCE.md` (produced by `lib/manifest.mjs`)
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
