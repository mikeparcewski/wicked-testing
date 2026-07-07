---
name: wicked-testing:incident-to-scenario-synthesizer
context: fork
description: |
  Turns a production incident into a deterministic scenario file that
  reproduces it. Takes an incident-report markdown OR direct fields
  (stack trace, endpoint URL, HTTP method, request body), extracts the
  minimal reproducer, writes `scenarios/<incident-id>.md` with
  `linked_to_incident:` frontmatter, emits `wicked.scenario.authored`
  with `source: incident`, and queues a review task under
  `assignee_skill: incident-to-scenario-synthesizer:review` so a human
  confirms before the scenario is marked active.

  Use when: postmortem follow-up, "write a regression test for INC-123",
  prod incident → scenario backport, error-class-to-test synthesis.

  <example>
  Context: Postmortem for INC-4829 (checkout 500 on coupon reuse) needs
  a regression scenario so the fix can be verified and future breaks caught.
  user: "Synthesize a scenario from docs/postmortems/INC-4829.md."
  <commentary>Use incident-to-scenario-synthesizer — it reads the
  postmortem, extracts stack + request + endpoint, writes scenarios/
  INC-4829.md with status: pending-review, emits wicked.scenario.authored,
  and queues a human-review task. Scenario is NOT active until approved.</commentary>
  </example>
---

# Incident-to-Scenario Synthesizer

Converts a production incident into a regression scenario. The output is
locked to `status: pending-review` until a human confirms the reproducer
triggers the expected error class.

## When to use

- Postmortem follow-up: "write a regression test for INC-123"
- Prod incident → scenario backport
- Error-class-to-test synthesis
- Any incident that needs a reproducible regression guard

## Process

1. Accept **Path A** (incident-report markdown) or **Path B** (direct fields: stack_trace, endpoint, request_body, error_class). Return `ERR_NO_INPUT` if neither is provided.
2. Extract deterministically — no LLM judgement. A missing required block (stack trace, endpoint, error class) is `ERR_INCIDENT_MALFORMED`, not a best-guess fill.
3. Write `scenarios/<incident_id>.md` with `status: pending-review`, `linked_to_incident:` frontmatter, a copy-pasteable bash reproducer, and explicit evidence expectations (which files the executor must produce and what the assertion is).
4. Emit `wicked.scenario.authored` with `source: incident` and queue a review task under `assignee_skill: incident-to-scenario-synthesizer:review`.

## Constraints

- `status: pending-review` is the only valid status on synthesis. Never mark a synthesized scenario `active`.
- `linked_to_incident:` is required frontmatter on every synthesized scenario.
- Reproducer omits destructive steps (DELETE, DROP, truncate); targets sandbox trust level only.
- On `ERR_SCENARIO_EXISTS` — surface the existing path and stop. Scenario overwrites are a human decision.

## Output

Writes `scenarios/<incident_id>.md`, `evidence/<run_id>/extracted.json`,
`synthesis-log.md`, `synthesized-scenario-path.txt`.

```
## Incident-to-Scenario: {incident_id}
endpoint: {method} {path}   expected_error_class: {class}
synthesized: scenarios/{incident_id}.md   status: pending-review
VERDICT=PASS REVIEWER=wicked-testing:incident-to-scenario-synthesizer RUN_ID={RUN_ID}
```
