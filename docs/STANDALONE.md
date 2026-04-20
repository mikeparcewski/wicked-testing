# Standalone Usage

You can use wicked-testing **without wicked-garden** or any other plugin.
SQLite is the only runtime requirement. wicked-bus and wicked-brain are
optional integrations.

---

## Install

```bash
npx wicked-testing install
```

The installer detects any AI CLI directory in your home (Claude Code,
Gemini CLI, Copilot, Codex, Cursor, Kiro) and copies:

- Five skills into `~/.<cli>/skills/wicked-testing-*/`
- Sixteen agents into `~/.<cli>/agents/wicked-testing-*.md`
- Ten commands into `~/.<cli>/commands/wicked-testing/`

Run `npx wicked-testing status` to confirm:

```
wicked-testing 0.1.0 — status
  claude     up to date
  cursor     up to date
```

---

## First Run

Open any supported CLI and invoke one of the five core commands:

```
/wicked-testing:plan "Add authenticated file upload to the dashboard"
/wicked-testing:authoring --scenario
/wicked-testing:execution scenarios/upload-auth.md
/wicked-testing:review <run-id>
/wicked-testing:insight "Has upload-auth passed in the last 24h?"
```

All evidence lands in `<cwd>/.wicked-testing/evidence/<run-id>/`.

---

## Core Workflow

```
   +-- plan -------------+
   |   what to test,     |
   |   risk, testability |
   +---------+-----------+
             |
             v
   +-- authoring --------+
   |  scenarios + code   |
   +---------+-----------+
             |
             v
   +-- execution --------+
   |  run + capture      |
   |  evidence           |
   +---------+-----------+
             |
             v
   +-- review -----------+
   |  independent        |
   |  verdict            |
   +---------+-----------+
             |
             v
   +-- insight ----------+
   |  stats, reports,    |
   |  oracle queries     |
   +---------------------+
```

Each stage writes to the same project-local ledger. Evidence is portable
(copy the `.wicked-testing/` directory with the project).

---

## Optional Integrations

### wicked-bus (event emission)

Install [wicked-bus](https://github.com/mikeparcewski/wicked-bus):

```bash
npx wicked-bus init
```

wicked-testing will detect it automatically and start emitting events:

- `wicked.testrun.started`
- `wicked.testrun.finished`
- `wicked.verdict.recorded`
- `wicked.evidence.captured`
- `wicked.scenario.authored`
- `wicked.teststrategy.authored`

Subscribe with `npx wicked-bus subscribe`.

### wicked-brain (knowledge memory)

Install [wicked-brain](https://github.com/mikeparcewski/wicked-brain):

```bash
npx wicked-brain init
```

On failures and flake signals, wicked-testing writes structured memories
(`failure-pattern`, `flake-signal`, `coverage-gap`, `test-decision`) that
future runs can recall. Search with `wicked-brain:search`.

Both integrations are **opt-in**. Without them, wicked-testing runs exactly
the same; only the bus emit / brain write are no-ops.

---

## Working With Scenarios

Scenarios are markdown files — human- and machine-readable. See
[SCENARIO-FORMAT.md](../SCENARIO-FORMAT.md) for the full format.

Short example:

```yaml
---
name: login-with-bad-credentials
category: api
tools:
  required: [curl]
difficulty: basic
timeout: 30
---

## Steps

### Step 1: POST /login with bad creds (curl)

\`\`\`bash
curl -sf -o /dev/null -w "%{http_code}" \
  -X POST https://api.local/login \
  -d '{"user":"a","pass":"wrong"}'
\`\`\`

**Expect**: HTTP 401
```

Run with:

```
/wicked-testing:execution scenarios/login-bad-creds.md
```

---

## Uninstall

```bash
npx wicked-testing uninstall
```

Removes skills/agents/commands from every detected CLI. Your project-local
`.wicked-testing/` directories are **not** touched.

---

## Troubleshooting

- **"No AI CLIs detected"** — wicked-testing looks for `~/.claude`, `~/.gemini`,
  `~/.github`, `~/.codex`, `~/.cursor`, `~/.kiro`. Use `--path=<dir>` if yours
  is non-standard.
- **Self-test failed** — `npx wicked-testing doctor` for diagnostics. Most
  often a `better-sqlite3` binary compatibility issue; re-install with
  `npm i -g wicked-testing --force`.
- **Windows** — use PowerShell or WSL; the installer falls back to `python`
  when `python3` is unavailable.

Open issues at https://github.com/mikeparcewski/wicked-testing/issues.
