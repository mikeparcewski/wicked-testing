# Evals — Agent Behavior Test Cases

Per-agent eval test cases for wicked-testing. Invoked on-demand via the
`wicked-testing-evals` dev skill or `node scripts/dev/evals.mjs`.

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
  "cases": [
    {
      "id": 1,
      "prompt": "Run the login-bad-credentials scenario and emit a verdict.",
      "input_files": ["scenarios/examples/login-bad-credentials.md"],
      "expected_shape": "manifest",
      "assertions": [
        { "kind": "produces-artifact", "path": ".wicked-testing/evidence/*/manifest.json" },
        { "kind": "manifest-valid",    "schema": "schemas/evidence.json" },
        { "kind": "verdict-in",        "values": ["PASS", "FAIL", "N-A", "SKIP"] }
      ]
    }
  ]
}
```

## Assertion kinds

| Kind                  | Meaning                                                       |
|-----------------------|---------------------------------------------------------------|
| `produces-artifact`   | Agent writes a file matching the glob                         |
| `manifest-valid`      | Output matches `schemas/evidence.json`                        |
| `verdict-in`          | Verdict field is one of the allowed values                    |
| `contains-text`       | Output contains a substring                                   |
| `matches-regex`       | Output matches a regex                                        |
| `json-has-key`        | JSON output has a specific key                                |
| `exit-code-zero`      | Runner exit code is 0                                         |

Assertion kinds are deterministic — no LLM judging. The LLM runs the agent;
the assertions are mechanical checks on the result.

## Cost discipline

Evals dispatch the real agent via Claude API, which costs tokens. The runner
prints an estimate before running and requires `--yes` to skip confirmation
on large runs (≥ 10 cases). Results cache in `.claude/skills/wicked-testing-evals/workspace/iteration-N/`.

See `.claude/skills/wicked-testing-evals/SKILL.md` for the runner workflow.
