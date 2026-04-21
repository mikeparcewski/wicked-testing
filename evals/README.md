# Evals — Agent Behavior Test Cases

Per-agent eval test cases for wicked-testing. Invoked on-demand via the
`wicked-testing-evals` dev skill or `node scripts/dev/evals.mjs`.

Runner infrastructure lives in `scripts/dev/evals.mjs` — see audit #71 for
the Wave 7a rebuild that added `not-contains-text`, `ledger-matches-manifest`,
`dispatches-agent`, tighter `produces-artifact`, model pinning, `evals:run`,
and the `check-all` structural gate.

## Layout

```
evals/
  <agent-name>/
    evals.json       # test cases for this agent
  README.md          # this file
```

## evals.json format

```jsonc
{
  "agent": "test-designer",
  "subagent_type": "wicked-testing:test-designer",
  "description": "Optional free-form summary",

  // Reproducibility pins (Wave 7a / #71). None are executed by the runner
  // itself — the host CLI's dispatcher is responsible for honoring them.
  // Recording them here puts the pin in the report.json so a red result
  // two weeks later can be reproduced against the same model.
  "model_pin":   "claude-sonnet-4-5",     // string; host CLI dispatcher honors
  "temperature": 0,                        // number; 0 = greediest reproducible
  "seed":        1,                        // integer; optional

  "cases": [
    {
      "id": 1,
      "prompt": "Run the login-bad-credentials scenario and emit a verdict.",
      "input_files": ["scenarios/examples/login-bad-credentials.md"],
      "expected_shape": "manifest",
      "model_override": null,   // per-case override of model_pin (rare)
      "assertions": [
        { "kind": "produces-artifact", "path": ".wicked-testing/evidence/*/manifest.json",
          "min_bytes": 200, "contains_regex": "\"verdict\"" },
        { "kind": "manifest-valid",    "schema": "schemas/evidence.json" },
        { "kind": "verdict-in",        "values": ["PASS", "FAIL", "N-A", "SKIP"] },
        { "kind": "not-contains-text", "values": ["STUB", "TODO"] }
      ]
    }
  ]
}
```

## Assertion kinds

| Kind                      | Meaning                                                                                 |
|---------------------------|-----------------------------------------------------------------------------------------|
| `produces-artifact`       | Agent writes a file matching the glob. Optional `min_bytes` + `contains_regex` strict.  |
| `manifest-valid`          | Output matches `schemas/evidence.json` (required top-level keys).                       |
| `verdict-in`              | Verdict field is one of the allowed values.                                             |
| `contains-text`           | Output contains a substring. Case-insensitive by default; `case_sensitive: true` opt.   |
| `not-contains-text`       | Output does NOT contain any value in `values` (or `value`). Critical for refusal cases. |
| `matches-regex`           | Output matches `pattern` (supports inline `(?i)` or explicit `flags`).                  |
| `exit-code-zero`          | Runner exit code is 0.                                                                  |
| `ledger-matches-manifest` | SQLite ledger's `runs.status` + `verdicts.verdict` agree with `manifest.json`. Catches dual-write drift. |
| `dispatches-agent`        | Skill-level: the dispatch trace names the expected `subagent_type`. Used for skill evals. |

Assertion kinds are deterministic — no LLM judging. The LLM runs the agent;
the assertions are mechanical checks on the captured output.

### Tightening `produces-artifact`

Previously `produces-artifact` passed if ANY file matched the glob — a
0-byte TODO stub would pass an `.test.js` assertion. Wave 7a added two
optional fields:

- `min_bytes: 200` — every matched file must be at least 200 bytes.
- `contains_regex: "\"verdict\""` — every matched file must contain the regex
  (use `contains_flags: "i"` for case-insensitive).

Both are additive — existing cases keep their old behavior.

## Runner commands

```bash
node scripts/dev/evals.mjs list                       # inventory eval sets
node scripts/dev/evals.mjs plan <agent>               # show cases + cost estimate
node scripts/dev/evals.mjs run  <agent>               # plan + model-pin info
node scripts/dev/evals.mjs check <agent> <iteration>  # verify a captured run
node scripts/dev/evals.mjs check-all                  # structural validation (CI-safe)
```

`check-all` is the gate for `.github/workflows/evals.yml` — a PR that adds
a case with a bogus assertion kind or a duplicate case id fails before the
reviewer sees it.

## Cost discipline

Evals dispatch the real agent via Claude API, which costs tokens. The runner
prints an estimate before running and requires `--yes` to skip confirmation
on large runs (≥ 10 cases). Results cache in
`.claude/skills/wicked-testing-evals/workspace/iteration-N/`.

See `.claude/skills/wicked-testing-evals/SKILL.md` for the runner workflow.
