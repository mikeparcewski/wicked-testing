---
name: wicked-testing:update
description: |
  Check for and install wicked-testing updates. Compares installed version
  against npm registry, updates the published CLI, refreshes skills / agents
  / commands across all detected AI CLIs (Claude Code, Gemini, Codex, Cursor,
  Kiro), and verifies the upgrade landed.

  Use when: "update wicked-testing", "check for updates", "wicked-testing:update",
  or periodically to stay current.
---

# wicked-testing:update

You check for and install updates to the published `wicked-testing` npm
package and refresh the skills / agents / commands it drops into each
detected AI CLI.

Unlike `wicked-brain` (which runs a persistent server that must be
restarted after upgrade), `wicked-testing` is a plugin — there is no
server to restart, no in-memory state to reload. The update flow is just
npm + skill-refresh, then a verify step.

## Cross-Platform Notes

Commands in this skill work on macOS, Linux, and Windows. Prefer your
native tools (Read, Write, Grep, Glob) over shell commands when possible.

## When to use

- User asks to update or check for updates.
- Periodically (suggest checking monthly).
- After encountering behavior that might be fixed in a newer version.
- Before opening a bug report — confirm the issue still reproduces on the
  latest release so the maintainer doesn't chase a ghost.

## Process

### Step 1: Check current installed version

Ask `wicked-testing` itself for its version. After Wave 1 (#32) the `--version`
subcommand emits bare semver, so any shell can parse it directly without
stripping a name prefix:

```bash
npx --yes wicked-testing --version 2>/dev/null || true
```

If nothing prints, the package was never installed globally (the user may
have been invoking via `npx` only each time). Treat this as "needs install"
and proceed to Step 4.

If you need a machine-readable form (scripts, CI):

```bash
npx --yes wicked-testing --version --json 2>/dev/null || true
# -> {"name":"wicked-testing","version":"0.2.0"}
```

**Alternative:** the `check` subcommand can gate on a range without
printing the raw version:

```bash
npx --yes wicked-testing check --require="^0.2.0"
# exit 0 = satisfies, 1 = does not satisfy, 2 = spec was unparseable
```

### Step 2: Check latest version on npm

```bash
npm view wicked-testing version 2>/dev/null || true
```

### Step 3: Compare versions

If the installed version matches the latest, report:
"wicked-testing is up to date (v{version})."

If an update is available, ask the user:
"wicked-testing v{new} is available (you have v{current}). Update now?"

### Step 4: Update (if user approves)

**Two artifacts move in lockstep:**

1. The **npm package** — reinstalled so `npx wicked-testing` resolves to the
   new version.
2. The **skills / agents / commands** dropped into each detected AI CLI's
   plugin directory (`~/.claude/`, `~/.gemini/`, `~/.codex/`, `~/.cursor/`,
   `~/.kiro/`). These live outside the npm install; `npx wicked-testing install`
   is what refreshes them from the updated package.

Running only one of the two creates a split-brain where the CLI sees stale
skill/agent files even though the npm package is fresh (or vice versa). Do
both.

```bash
npm install -g wicked-testing@latest 2>&1
```

On Windows PowerShell (no change needed):
```powershell
npm install -g wicked-testing@latest
```

If this fails with `EACCES` / permission denied:
- macOS/Linux: `sudo npm install -g wicked-testing@latest`
- Windows: re-run the shell as Administrator, or fix npm's global prefix per
  npm docs. Do NOT silently skip — report the failure and stop.

Then refresh per-CLI deployments:

```bash
npx --yes wicked-testing install
```

This is idempotent — per-CLI markers (`.wicked-testing-version` inside the
skills dir) skip CLIs that are already current. Pass `--force` to
re-copy even when versions match. Options:

```bash
# Restrict to a subset of CLIs
npx --yes wicked-testing install --cli=claude,gemini

# Override identity-marker detection (use when the CLI's marker set diverges
# from the built-in heuristic; see Wave 5 #60)
npx --yes wicked-testing install --assume-cli=codex

# Machine-readable per-target report
npx --yes wicked-testing install --json
```

### Step 4a: Verify the update landed

Re-run Step 1 and compare to Step 2:

```bash
npx --yes wicked-testing --version 2>/dev/null || true
```

The version reported MUST match the latest. If it still shows the old
version:

1. Check `which wicked-testing` (macOS/Linux) or `where wicked-testing` (Windows).
   The shell may have cached a path to a different install.
2. Clear npm's cache: `npm cache clean --force`, then re-run Step 4.
3. Check whether a Node version manager (`nvm` / `fnm` / `volta`) is pinning a
   stale copy via `nvm current` / `fnm current`.

Do NOT proceed to Step 5 until the version check succeeds. Reporting a
successful update while the CLI resolves to a stale binary is the top
failure mode of this skill.

### Step 5: Run doctor to confirm health

The doctor subcommand runs structured diagnostics — node version, per-CLI
install integrity (expected agent files present and non-empty), better-sqlite3
loadability, SQLite schema version vs code, plugin.json drift (see Wave 5
#74). Green doctor output is the "update succeeded" contract:

```bash
npx --yes wicked-testing doctor
```

If anything reports FAIL, share the remediation line with the user and
stop. Warnings are OK to proceed past.

For a one-line machine-readable summary:

```bash
# Keep stderr OFF the pipe — mixing warnings into the JSON stream
# poisons the parser. We silence stderr at the outer level instead.
npx --yes wicked-testing doctor --json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(f\"healthy={d['healthy']} warnings={d['warnings']}\")" 2>/dev/null \
  || npx --yes wicked-testing doctor --json 2>/dev/null | python -c "import json,sys; d=json.load(sys.stdin); print(f\"healthy={d['healthy']} warnings={d['warnings']}\")"
```

### Step 6: Ledger schema auto-migrates on next use (no action needed)

`wicked-testing`'s SQLite ledger lives at `.wicked-testing/wicked-testing.db`
(per project). When a `wicked-testing` command next opens it, the migration
runner in `lib/migrate.mjs` applies any pending migrations in order inside a
transaction (see Wave 4 #52). No manual migration step is needed from this
skill.

If a project has a DB that was written by a NEWER version than the code,
DomainStore refuses to write and prints: *"wicked-testing.db was written by
a newer version (DB vN, code vM). Upgrade the plugin with: npm install -g
wicked-testing@latest"*. This shouldn't happen after a successful update,
but if it does the remediation is the same: redo Step 4.

### Step 7: Report

Tell the user what changed:

```
wicked-testing: v{old} -> v{new}
Skills/agents/commands refreshed in: {list of CLI names}
Doctor: {healthy|N warnings}
```

If the user opted not to update, report the current-vs-available gap and
end.

## Version check without updating

If the user just wants to check (not update), stop after Step 3 and report:

```
Installed: v{current}
Latest:    v{latest}
```

## Reading the changelog (optional but kind)

Between Step 3 and Step 4, the user may want to see what changed. The
repo publishes release notes on GitHub:

```bash
# Latest release notes — human-readable
gh release view --repo mikeparcewski/wicked-testing 2>/dev/null \
  || echo "gh not authenticated; see https://github.com/mikeparcewski/wicked-testing/releases"
```

Offer this before Step 4 if the gap is more than a patch bump (e.g., 0.2.x
-> 0.3.0), so the user can skim new features and breaking changes before
committing.
