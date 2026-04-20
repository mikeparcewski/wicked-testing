---
name: wicked-testing-scenarios-library
description: |
  Browse, copy, and customize exemplar scenarios from scenarios/examples/.
  Also generates new scenarios from a feature description using the example
  patterns as a template.

  Use when: "give me a template for X", "how do I write a browser scenario",
  "copy the API health check template", "generate a scenario for this feature".
---

# wicked-testing-scenarios-library (dev skill)

Repo-local dev skill. Operates on this repo's exemplar scenarios and helps
scaffold new ones.

## Capabilities

### 1. Browse

List what's in `scenarios/examples/` with a one-line summary per file.
Read a specific example with the Read tool.

### 2. Copy

Copy an example into a target location (typically `scenarios/<new-name>.md`
in the caller's project), rewriting the frontmatter `name` and
`description` fields to match.

### 3. Generate

Given a feature description, pick the closest example, copy it, and rewrite
the steps to match the feature. The output is a draft — the user must
review for correctness before running.

## Categories available

| Category  | Example                          |
|-----------|----------------------------------|
| api       | `api-health-check.md`            |
| api (neg) | `login-with-bad-credentials.md`  |
| browser   | `browser-page-audit.md`          |
| perf      | `perf-load-test.md`              |
| a11y      | `a11y-wcag-check.md`             |
| security  | `security-sast-scan.md`          |
| infra     | `infra-container-scan.md`        |

## Rules

- Every scenario MUST include a positive AND a negative path if feasible
- CLI tools listed in `tools.required` must be actually invoked in steps
- Assertions must be mechanical — exit codes, HTTP statuses, schema matches —
  not natural-language "looks good"
- Cleanup section removes any temp files the steps created

## Promotion path

If consumers want the same capability (seed their own project's scenarios
directory from templates), promote the skill and the `scenarios/examples/`
tree together. The examples are already in `package.json` `files` so they
ship — only the dev skill wrapper is repo-local.

## References

- [`scenarios/examples/`](../../../scenarios/examples/) — template library
- [SCENARIO-FORMAT.md](../../../SCENARIO-FORMAT.md) — format spec
