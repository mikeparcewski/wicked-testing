---
name: browser-automation
description: |
  Detect and configure browser automation tools (Playwright, Cypress, k6).
  Generates test harness scaffolds and automation code for browser-based scenarios.

  Use when: "browser tests", "playwright", "cypress", "automate browser", "UI testing",
  "end-to-end browser test", "web automation", "browser automation",
  "/wicked-testing:automate"
---

# Browser Automation Skill

Detects the best available browser automation tool in your environment and generates harness scaffolds for browser-based test scenarios.

## CLI Discovery

Before generating any automation code, detect which tool is available:

```bash
# Priority order: playwright > cypress > k6 (for perf/API) > puppeteer
for tool in playwright cypress k6 puppeteer; do
  if command -v "$tool" > /dev/null 2>&1; then
    echo "Using: $tool"
    break
  fi
  # Check via npx for Node-based tools
  if command -v npx > /dev/null 2>&1; then
    if npx "$tool" --version > /dev/null 2>&1; then
      echo "Using: npx $tool"
      break
    fi
  fi
done
```

## Priority Order

| Priority | Tool | Why |
|----------|------|-----|
| 1 | **Playwright** | Best AI-agent support, cross-browser, built-in waiting, trace viewer |
| 2 | **Cypress** | Test-focused DX, component testing, good CI support |
| 3 | **k6** | Performance/load testing, API testing |
| 4 | **Puppeteer** | Mature API, Chrome-focused |

## Command

```
/wicked-testing:automate [scenario-file] [--framework playwright|cypress|k6] [--json]
```

- `scenario-file` — wicked-testing scenario file to generate automation for
- `--framework` — force a specific framework (overrides detection)
- `--json` — emit JSON envelope

## Instructions

### 1. Detect Available Tools

Run the detection script above. Report which tool was selected.

If no tool is found, recommend Playwright and provide install instructions:

```bash
# Install Playwright (recommended)
npm i -D @playwright/test
npx playwright install

# Or Cypress
npm i -D cypress

# Or k6 (for performance testing)
brew install k6
```

### 2. Read the Scenario

Parse the scenario file's frontmatter. Map the category to the appropriate automation approach:

| Scenario Category | Recommended Tool | Approach |
|-------------------|-----------------|----------|
| browser | playwright or cypress | Page interactions, assertions |
| perf | k6 | Load scripts, thresholds |
| api | k6 or curl | HTTP assertions |
| a11y | playwright + axe | Accessibility audit |

### 3. Generate Harness Scaffold

Based on detected tool, generate a harness scaffold that matches the scenario steps.

#### Playwright scaffold:

```javascript
// tests/{scenario-name}.spec.ts
import { test, expect } from '@playwright/test';

test.describe('{scenario description}', () => {
  test.beforeEach(async ({ page }) => {
    // Setup from scenario ## Setup section
  });

  test('{step description}', async ({ page }) => {
    // Generated from scenario step
    await page.goto('{url}');
    await expect(page.locator('{selector}')).toBeVisible();
  });

  test.afterEach(async ({ page }) => {
    // Cleanup from scenario ## Cleanup section
  });
});
```

#### Cypress scaffold:

```javascript
// cypress/e2e/{scenario-name}.cy.js
describe('{scenario description}', () => {
  beforeEach(() => {
    // Setup
  });

  it('{step description}', () => {
    cy.visit('{url}');
    cy.get('{selector}').should('be.visible');
  });
});
```

#### k6 scaffold (performance):

```javascript
// tests/{scenario-name}.k6.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function() {
  const res = http.get('{url}');
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
  sleep(1);
}
```

### 4. Write Configuration

If a test config file doesn't exist, scaffold it:

- `playwright.config.ts` for Playwright
- `cypress.config.js` for Cypress
- (k6 config is inline in the script)

### 5. Output

**Without `--json`** — Return a summary with file paths and run commands:

```markdown
## Browser Automation Scaffold: {scenario-name}

**Tool detected**: Playwright v{version}
**Files created**:
- tests/{scenario-name}.spec.ts
- playwright.config.ts (if not present)

**Run with**:
```bash
npx playwright test tests/{scenario-name}.spec.ts
npx playwright test --ui  # Interactive mode
```

**CI command**: `npx playwright test --reporter=junit`
```

**With `--json`** — Use `scripts/_python.sh` Python pattern for the JSON envelope.

## Browser Testing Standards

Every browser test MUST:
- Monitor browser console for JS errors (any unhandled exception = automatic FAIL)
- Use headless configuration (`--headless` or `headless: true`)
- Include explicit waits — never `sleep N`, always wait-for-condition
- Run cleanup after tests, even on failure

## Integration

- Works with scenarios from `/wicked-testing:scenarios`
- Scaffold can be run via `/wicked-testing:run`
- Evidence collected by `/wicked-testing:acceptance` 3-agent pipeline
