// wicked-testing plugin for opencode (SST/opencode-ai)
// Hooks into two lifecycle events:
//   session.created  → shows QE project status at session open
//   session.idle     → claim-nudge + surfaces recent reviewer verdict
//
// Installed at: ~/.config/opencode/plugins/wicked-testing.ts
// Hook scripts: ~/.config/opencode/plugins/wicked-testing-hooks/

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const hooksDir = join(dirname(fileURLToPath(import.meta.url)), "wicked-testing-hooks");

function runHook(hook: string, cwd: string): void {
  try {
    spawnSync("node", [join(hooksDir, hook)], {
      input: JSON.stringify({ cwd }),
      stdio: ["pipe", "ignore", "inherit"],
      timeout: 5000,
    });
  } catch { /* graceful degradation — never fail the session */ }
}

// Plugin function — opencode calls this with a context object and uses the
// returned hooks map to register event handlers.
export const wickedTestingPlugin = async (ctx: { directory: string }) => ({
  // session.created fires once per opencode invocation (new session).
  "session.created": async () => {
    runHook("session-start.mjs", ctx.directory);
  },
  // session.idle fires when the agent finishes its response (Stop equivalent).
  "session.idle": async () => {
    runHook("claim-nudge.mjs", ctx.directory);
    runHook("subagent-verdict.mjs", ctx.directory);
  },
});
