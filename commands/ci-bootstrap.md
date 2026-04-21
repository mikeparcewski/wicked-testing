---
description: Detect the CI provider in this repo and write the matching wicked-testing acceptance template
argument-hint: "[--provider github-actions|gitlab|jenkins|buildkite] [--dry-run] [--json]"
---

# /wicked-testing:ci-bootstrap

Detect the CI provider for the current repository and drop the
appropriate wicked-testing acceptance template into its conventional
location. Idempotent — re-running replaces the template only if the
`wicked-testing:ci-bootstrap:managed` marker is still present.

See [`docs/CI.md`](../docs/CI.md) for the exit-code contract, secret
configuration, retention defaults, and the PR-comment generator.

## Usage

```
/wicked-testing:ci-bootstrap [--provider <name>] [--dry-run] [--json]
```

- `--provider` — override auto-detection (`github-actions|gitlab|jenkins|buildkite`)
- `--dry-run` — report what would be written, do not touch the filesystem
- `--json` — emit the standard JSON envelope

## Instructions

### 1. Detect the provider

Apply the rules in order; first match wins:

```bash
if [ -d ".github/workflows" ]; then
  provider=github-actions
elif [ -f ".gitlab-ci.yml" ]; then
  provider=gitlab
elif [ -f "Jenkinsfile" ]; then
  provider=jenkins
elif [ -f ".buildkite/pipeline.yml" ]; then
  provider=buildkite
else
  provider=""
fi
```

If `--provider` is supplied, use it directly and skip detection.

If nothing matched and `--provider` was not given:
- In `--json` mode, return `ok: false`, `code: ERR_NO_PROVIDER`, and the
  list of detection rules so the caller can fix it.
- Otherwise prompt the user with the four options and default to
  `github-actions` on empty input.

### 2. Resolve target path per provider

| Provider         | Target path                                                   | Source template                              |
|------------------|---------------------------------------------------------------|----------------------------------------------|
| `github-actions` | `.github/workflows/wicked-testing-acceptance.yml`             | `templates/ci/github-actions-acceptance.yml` |
| `gitlab`         | `.gitlab-ci.wicked-testing.yml` (include from main pipeline)  | `templates/ci/gitlab-ci.yml`                 |
| `jenkins`        | `Jenkinsfile.wicked-testing`                                  | `templates/ci/jenkins-pipeline.groovy`       |
| `buildkite`      | `.buildkite/wicked-testing.yml`                               | `templates/ci/buildkite.yml`                 |

The filenames are deliberately sidecar paths — they never overwrite a
project's existing primary pipeline file. Consumers wire them in via
`include:` (GitLab), composite workflows (GHA), stage libraries (Jenkins),
or `pipeline upload` steps (Buildkite).

### 3. Idempotency marker

Each template ships with a comment line:

```
wicked-testing:ci-bootstrap:managed
```

On re-run:
- If the target file does **not** exist → write it.
- If the target file exists **and** contains the marker → overwrite it
  (and mention `replaced: true` in the summary).
- If the target file exists **but the marker is gone** → refuse to
  overwrite. Return `ok: false`, `code: ERR_TEMPLATE_UNMANAGED`, and
  tell the user to either delete the file manually or re-add the marker.

### 4. Dry-run

With `--dry-run`, perform detection + path resolution + marker check,
but do NOT write. The summary should report `action: would-create` or
`action: would-replace` instead.

### 5. Write the template

Copy the source template verbatim — the marker comment is already inside
it. Ensure the parent directory exists:

```bash
mkdir -p "$(dirname "${target_path}")"
cp "${plugin_root}/templates/ci/${source}" "${target_path}"
```

### 6. Output

**Without `--json`** — print a 3-line summary:

```
wicked-testing ci-bootstrap — provider: github-actions
wrote: .github/workflows/wicked-testing-acceptance.yml (managed)
next:  configure ANTHROPIC_API_KEY secret; see docs/CI.md
```

(Substitute `would-write` for `wrote` in `--dry-run` mode, and
`replaced` when an existing managed file was overwritten.)

**With `--json`** — emit the envelope:

```bash
python3 -c "import json,sys; sys.stdout.write(json.dumps({'ok': True, 'data': {'provider': 'github-actions', 'target_path': '.github/workflows/wicked-testing-acceptance.yml', 'source_template': 'templates/ci/github-actions-acceptance.yml', 'action': 'created', 'managed': True, 'dry_run': False}, 'meta': {'command': 'wicked-testing:ci-bootstrap', 'duration_ms': 0, 'schema_version': 1}}))" 2>/dev/null || python -c "import json,sys; sys.stdout.write(json.dumps({'ok': True, 'data': {'provider': 'github-actions', 'target_path': '.github/workflows/wicked-testing-acceptance.yml', 'source_template': 'templates/ci/github-actions-acceptance.yml', 'action': 'created', 'managed': True, 'dry_run': False}, 'meta': {'command': 'wicked-testing:ci-bootstrap', 'duration_ms': 0, 'schema_version': 1}}))"
```

`action` is one of `created | replaced | would-create | would-replace | skipped-unmanaged`.

### 7. Error codes

| Code                       | Exit | When                                                       |
|----------------------------|------|------------------------------------------------------------|
| `ERR_NO_PROVIDER`          | 3    | Auto-detect found nothing and no `--provider` given (non-TTY) |
| `ERR_TEMPLATE_UNMANAGED`   | 3    | Target exists without the `:managed` marker; refusing      |
| `ERR_TEMPLATE_NOT_FOUND`   | 3    | Plugin installation is missing `templates/ci/`             |

All three map to exit `3` (INFRA) per [`docs/CI.md`](../docs/CI.md) §1.

### 8. Next-steps nudge

After a successful write (non-dry-run), print:

```
Next:
  1. Configure ANTHROPIC_API_KEY in your provider's secrets UI.
  2. Commit the new pipeline file.
  3. Open a PR — the acceptance pipeline runs on every PR by default.
  4. See docs/CI.md for exit-code, artifact, and PR-comment details.
```
