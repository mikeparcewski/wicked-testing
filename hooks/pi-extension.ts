// wicked-testing extension for pi (earendil-works/pi)
// Loaded via jiti — no compilation needed.
// Hooks into two lifecycle events:
//   session_start  → shows QE project status at session open
//   agent_end      → claim-nudge + surfaces recent reviewer verdict
//
// Installed at: ~/.pi/agent/extensions/wicked-testing.ts
// Hook scripts: ~/.pi/agent/extensions/wicked-testing-hooks/

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

// Extension factory — pi passes ExtensionAPI; use pi.on() to register handlers.
export default function (pi: { on(event: string, handler: (event: unknown, ctx: { sessionManager?: { session?: { cwd?: string } } }) => Promise<void>): void }) {
  // session_start fires when a session is started, loaded, or reloaded.
  pi.on("session_start", async (_event, ctx) => {
    const cwd = ctx.sessionManager?.session?.cwd ?? process.cwd();
    runHook("session-start.mjs", cwd);
  });

  // agent_end fires once per agent response (Stop equivalent).
  pi.on("agent_end", async (_event, ctx) => {
    const cwd = ctx.sessionManager?.session?.cwd ?? process.cwd();
    runHook("claim-nudge.mjs", cwd);
    runHook("subagent-verdict.mjs", cwd);
  });
}
