# CI Integration Guide

How to wire wicked-testing into a Continuous Integration pipeline —
exit-code contract, artifact publishing, PR-comment summaries, secrets,
headless-mode conventions, and caching rules.

Ready-to-paste templates for the major providers live in
[`templates/ci/`](../templates/ci/). Use `/wicked-testing:ci-bootstrap`
to detect your provider and drop the right file into the correct
location.

---

## 1. Exit-Code Contract

Every wicked-testing command that runs a scenario or returns a verdict
maps its outcome to a process exit code. This contract is stable across
minor versions — CI pipelines may condition on these codes.

| Code   | Meaning        | When emitted                                                                  |
|--------|----------------|-------------------------------------------------------------------------------|
| `0`    | PASS           | Verdict `PASS`, or command succeeded with no verdict expected                 |
| `1`    | FAIL           | Verdict `FAIL` — assertions failed, evidence present                          |
| `2`    | INCONCLUSIVE   | Verdict `INCONCLUSIVE` — evidence missing, context contamination, or `PARTIAL` |
| `3`    | INFRA          | Missing tool, network failure, permission error; `ERR_*` codes from stderr   |
| `64-78`| Per-command    | Reserved range (matches Unix sysexits(3) conventions)                         |

### Mapping existing `ERR_*` codes

The command surface already emits named error codes (see
[HOW-IT-WORKS.md §Error Paths](../HOW-IT-WORKS.md#error-paths)). They
map to the numeric contract as follows:

| `ERR_*` code                 | Numeric exit | Rationale                                            |
|------------------------------|--------------|------------------------------------------------------|
| `ERR_NO_CONFIG`              | `3`          | Infra: `/wicked-testing:setup` not run               |
| `ERR_SCENARIO_NOT_FOUND`     | `3`          | Infra: user/pipeline pointed at a bad path           |
| `ERR_SQLITE_UNAVAILABLE`     | `3`          | Infra: native module failed to load                  |
| `ERR_FILTER_INVALID`         | `3`          | Infra: oracle invocation misconfigured               |
| `ERR_CONTEXT_CONTAMINATION`  | `2`          | Inconclusive — reviewer isolation broken             |
| `ERR_JSON_WRITE_FAILED`      | `3`          | Infra: file-system / permissions                     |
| `ERR_TOOL_MISSING`           | `3`          | Infra: test CLI (playwright/cypress/k6) not on PATH  |

Two existing spots don't map cleanly and should be treated as advisory:

- `/wicked-testing:run` exits `2` on **PARTIAL** (mixed PASS + SKIP).
  The new contract keeps `2` semantically equivalent (inconclusive),
  just widened to cover INCONCLUSIVE verdicts.
- Agent-specific codes in the `64-78` range (e.g. `ERR_AXE_TIMEOUT`)
  remain per-agent. Pipelines should treat `64-78` as "command-specific,
  see stderr".

### Example — conditional CI step

```bash
set +e
npx --yes wicked-testing acceptance "${SCENARIO}" --json > acceptance.json
code=$?
set -e
case "${code}" in
  0) echo "PASS"  ;;
  1) echo "FAIL"  ; exit 1 ;;
  2) echo "INCONCLUSIVE — re-run with verbose logs" ; exit 0 ;;
  3) echo "INFRA — see acceptance.json and stderr"  ; exit 3 ;;
  *) echo "Unknown exit ${code}" ; exit "${code}" ;;
esac
```

---

## 2. Artifact Publishing

Every acceptance run writes `manifest.json` to
`.wicked-testing/evidence/<run-id>/` (see [EVIDENCE.md](EVIDENCE.md)).
Upload **the whole evidence directory** — the manifest plus the
`artifacts/` subtree — so reviewers can drill from summary into
screenshots and logs.

**Default retention: 14 days.** Older runs live in the SQLite ledger;
re-hydrate on demand by cloning at the commit SHA and re-running.

### Per-provider upload recipes

| Provider       | Upload directive                                   | Retention knob                    |
|----------------|----------------------------------------------------|-----------------------------------|
| GitHub Actions | `actions/upload-artifact@v4` with `retention-days: 14` | `retention-days` on the step  |
| GitLab CI      | `artifacts.paths:` + `artifacts.expire_in: 14 days`| `expire_in`                       |
| Jenkins        | `archiveArtifacts` + `buildDiscarder(artifactNumToKeepStr)` | `logRotator`             |
| Buildkite      | `artifact_paths:` (list of globs)                  | Org-level artifact retention setting |

All four templates in [`templates/ci/`](../templates/ci/) use the
same glob pattern:

```
.wicked-testing/evidence/**/manifest.json
.wicked-testing/evidence/**/artifacts/**
.wicked-testing/logs/**
```

### What NOT to upload

- `.wicked-testing/wicked-testing.db` — project-local SQLite ledger.
  Not portable; not useful out-of-context.
- `.wicked-testing/projects/`, `.wicked-testing/runs/*.json`, etc. —
  internal store shape, explicitly not a public contract.

---

## 3. PR-Comment Summary

Each template ships a step that turns `manifest.json` + the JSON
envelope from `/wicked-testing:acceptance --json` into a compact
markdown comment posted on the PR / MR.

### Target comment shape

```markdown
### wicked-testing — acceptance

**Verdict**: FAIL  ·  run `b47ac10b-58cc-4372-a567-0e02b2c3d479`
**Scenario**: `scenarios/auth/login-bad-creds.md`
**Duration**: 3.2s  ·  **Artifacts**: 7

| Assertion                                 | Status |
|-------------------------------------------|--------|
| POST /login returns 401 on bad creds      | FAIL   |
| Response body contains `invalid_grant`    | PASS   |
| No session cookie issued                  | PASS   |

<details><summary>Evidence</summary>

- `step-1-login-form.png`
- `step-3-response.json`
- `run.log` (8 KB)

</details>
```

### Generator snippet (`scripts/ci/manifest-to-comment.py`)

Drop this into your repo at `scripts/ci/manifest-to-comment.py`. The
templates shell out to it; keep it self-contained and dependency-free
so it runs on any `node:20` container.

```python
#!/usr/bin/env python3
"""Turn a wicked-testing manifest + acceptance log into a PR comment."""
import argparse, glob, json, pathlib, sys

def load(path):
    try:
        return json.loads(pathlib.Path(path).read_text())
    except Exception:
        return None

def find_manifest(pattern):
    hits = sorted(glob.glob(pattern))
    if not hits:
        return None
    # Newest by mtime.
    hits.sort(key=lambda p: pathlib.Path(p).stat().st_mtime, reverse=True)
    return load(hits[0])

def render(manifest, log):
    if not manifest:
        return "_(wicked-testing: no manifest produced for this run)_"
    verdict = manifest.get("verdict", {}).get("value", "INCONCLUSIVE")
    run_id = manifest.get("run_id", "?")
    scenario = manifest.get("scenario_path", "?")
    duration_ms = manifest.get("duration_ms", 0)
    artifacts = manifest.get("artifacts", [])
    assertions = []
    if log and log.get("data", {}).get("assertions"):
        assertions = log["data"]["assertions"]

    out = []
    out.append("### wicked-testing - acceptance")
    out.append("")
    out.append(f"**Verdict**: {verdict}  -  run `{run_id}`")
    out.append(f"**Scenario**: `{scenario}`")
    out.append(f"**Duration**: {duration_ms/1000:.1f}s  -  **Artifacts**: {len(artifacts)}")
    out.append("")
    if assertions:
        out.append("| Assertion | Status |")
        out.append("|---|---|")
        for a in assertions:
            out.append(f"| {a.get('name','?')} | {a.get('status','?')} |")
        out.append("")
    if artifacts:
        out.append("<details><summary>Evidence</summary>")
        out.append("")
        for a in artifacts[:20]:
            out.append(f"- `{a.get('name','?')}`")
        out.append("")
        out.append("</details>")
    return "\n".join(out)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest-glob", required=True)
    ap.add_argument("--log", required=True)
    args = ap.parse_args()
    manifest = find_manifest(args.manifest_glob)
    log = load(args.log)
    sys.stdout.write(render(manifest, log) + "\n")

if __name__ == "__main__":
    main()
```

### Per-provider posting mechanism

| Provider       | How the comment gets posted                                         |
|----------------|---------------------------------------------------------------------|
| GitHub Actions | `gh pr comment <N> --body-file <path>` using `secrets.GITHUB_TOKEN` |
| GitLab CI      | `curl POST /merge_requests/<iid>/notes` with `GITLAB_API_TOKEN`     |
| Jenkins        | `pullRequest.comment(body)` from the pipeline-github plugin         |
| Buildkite      | `buildkite-agent annotate` (no native PR comment — build-page panel)|

**Buildkite caveat**: Buildkite has no first-party GitHub/GitLab PR
commenting. Installations that need a true PR comment bolt on a post-step
hook calling `gh pr comment` (requires `GH_TOKEN` in the step env).

---

## 4. Secrets

### Required

| Secret              | Purpose                                              |
|---------------------|------------------------------------------------------|
| `ANTHROPIC_API_KEY` | Powers the 3-agent acceptance pipeline (Writer / Executor / Reviewer). |

### Optional (per-provider)

| Secret              | Provider           | Purpose                                  |
|---------------------|--------------------|------------------------------------------|
| `GITHUB_TOKEN`      | GitHub Actions     | PR comment posting (auto-provided)       |
| `GITLAB_API_TOKEN`  | GitLab CI          | MR note posting (masked CI variable)     |
| `anthropic-api-key` | Jenkins (cred ID)  | Bound via `credentials('anthropic-api-key')` |

### Per-provider injection

- **GitHub Actions** — Settings → Secrets and variables → Actions → New repository secret.
  Expose as `env: ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}`.
- **GitLab CI** — Project → Settings → CI/CD → Variables. Mark **Masked**
  and **Protected** as appropriate. Referenced as `${ANTHROPIC_API_KEY}`.
- **Jenkins** — Manage Jenkins → Credentials → Add "Secret text" with
  ID `anthropic-api-key`. Bind via `environment { ANTHROPIC_API_KEY = credentials('anthropic-api-key') }`.
- **Buildkite** — Org or pipeline secrets (`buildkite-agent secret get`
  or the `secrets` agent helper). Exposed to the step via the
  `docker#v5` plugin's `environment:` list.

### Guard step

Every template fails fast with exit code `3` if `ANTHROPIC_API_KEY` is
unset — this makes secret-misconfiguration look like INFRA, not FAIL.

---

## 5. Headless Mode

wicked-testing commands can prompt interactively when run from a TTY.
**In CI, every command must be headless.** The contract:

1. **Always pass `--json`.** The `--json` flag is wicked-testing's
   documented headless path. It suppresses markdown output, disables
   prompts, and emits a stable JSON envelope (`{ok, data, meta}` or
   `{ok: false, error, code}`).
2. **Tee every invocation's output to a per-step log file.** Each
   template writes to `.wicked-testing/logs/<command>.json`. This
   keeps the raw envelope available to the PR-comment generator and
   to evidence archival.
3. **Set `WICKED_TESTING_CI=1`.** Commands treat this as an extra
   signal to skip any ANSI output and never prompt.

Example:

```bash
set -o pipefail
mkdir -p .wicked-testing/logs
npx --yes wicked-testing acceptance "${SCENARIO}" --json \
  | tee .wicked-testing/logs/acceptance.json
```

`set -o pipefail` is required — otherwise `tee` masks the real
exit code from the wicked-testing command.

---

## 6. Caching

**Do not cache `.wicked-testing/` across CI runs.**

The `.wicked-testing/` directory is **project-local state**, not build
output. It contains:

- `wicked-testing.db` — SQLite ledger rebuilt per project from the JSON
  source of truth.
- `evidence/<run-id>/` — per-run artifacts. Each CI run gets a fresh UUID
  so caching them across jobs produces stale, misleading evidence.
- `projects/`, `scenarios/`, `runs/`, `verdicts/` — mutable state that
  should reflect only the current run.

What **is** safe to cache:

- `node_modules/` — as usual for Node projects (`actions/cache` with
  `package-lock.json` as the key).
- The npx cache (`~/.npm/_npx/`) — speeds up repeated
  `npx --yes wicked-testing install` calls.

### Anti-example (do not do this)

```yaml
# WRONG — caches per-run evidence, corrupts subsequent runs.
- uses: actions/cache@v4
  with:
    path: .wicked-testing/
    key: wicked-testing-${{ runner.os }}
```

### Correct pattern

Install fresh every run; upload evidence as an **artifact**, not a
cache:

```yaml
- run: npx --yes wicked-testing install
- run: npx --yes wicked-testing acceptance "${SCENARIO}" --json
- uses: actions/upload-artifact@v4
  with:
    name: evidence
    path: .wicked-testing/evidence/**
    retention-days: 14
```

---

## 7. Bootstrapping a provider

```
/wicked-testing:ci-bootstrap              # auto-detect, write template, print summary
/wicked-testing:ci-bootstrap --dry-run    # show what would be written
/wicked-testing:ci-bootstrap --json       # machine-readable summary
```

Detection rules (first match wins):

1. `.github/workflows/` exists → **github-actions**
2. `.gitlab-ci.yml` at root   → **gitlab**
3. `Jenkinsfile` at root      → **jenkins**
4. `.buildkite/pipeline.yml`  → **buildkite**
5. None of the above          → prompt; default **github-actions**

The command drops the template into the provider's conventional path
and appends a `wicked-testing:ci-bootstrap:managed` marker comment so
subsequent runs are idempotent.
