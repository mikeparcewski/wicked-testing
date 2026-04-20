# Example Scenarios

Templates you can copy into your own project's `scenarios/` directory.
Each file demonstrates one test category with working, runnable commands.

| File                                | Category  | Demonstrates                                         |
|-------------------------------------|-----------|------------------------------------------------------|
| `smoke-test-execution.md`           | api       | **Run first** — proves execution pipeline fires real commands (curl+python3 only) |
| `api-health-check.md`               | api       | HTTP 200, JSON shape, hurl assertions                |
| `login-with-bad-credentials.md`     | api       | Negative test — invalid creds → 401                  |
| `browser-page-audit.md`             | browser   | Page load, interaction, JS errors                    |
| `perf-load-test.md`                 | perf      | k6 / hey basic load probe                            |
| `a11y-wcag-check.md`                | a11y      | pa11y WCAG 2.1 AA audit                              |
| `security-sast-scan.md`             | security  | semgrep SAST pattern check                           |
| `infra-container-scan.md`           | infra     | trivy container/image vulnerability scan             |

## How to use

1. Copy a template into `<your-project>/scenarios/`
2. Edit the frontmatter (`name`, `description`, `timeout`)
3. Edit the steps — change URLs, credentials, expected values
4. Run with `/wicked-testing:execution scenarios/<your-scenario>.md`

## Format reference

See [SCENARIO-FORMAT.md](../../SCENARIO-FORMAT.md) for the full format
specification (frontmatter fields, step syntax, category list, tool
discovery rules).

## Requesting new templates

Open an issue at https://github.com/mikeparcewski/wicked-testing/issues
with the `scenarios` label.
