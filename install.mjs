#!/usr/bin/env node
// wicked-testing CLI — install, update, uninstall, status, version, doctor.
// Cross-platform: macOS/Linux primary, Windows best-effort via python3||python fallback.

import {
  existsSync, mkdirSync, cpSync, readdirSync, rmSync,
  readFileSync, writeFileSync,
} from "node:fs";
import { join, resolve, basename } from "node:path";
import { homedir } from "node:os";
import { argv, exit, cwd } from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const home = homedir();

const PKG = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8"));
const VERSION = PKG.version;
const INSTALLED_MARKER = ".wicked-testing-version";

const CLI_TARGETS = [
  { name: "claude",  dir: join(home, ".claude",  "skills"), agentDir: join(home, ".claude",  "agents"), commandDir: join(home, ".claude",  "commands"), platform: "claude"  },
  { name: "gemini",  dir: join(home, ".gemini",  "skills"), agentDir: join(home, ".gemini",  "agents"), commandDir: join(home, ".gemini",  "commands"), platform: "gemini"  },
  { name: "copilot", dir: join(home, ".github",  "skills"), agentDir: join(home, ".github",  "agents"), commandDir: join(home, ".github",  "commands"), platform: "copilot" },
  { name: "codex",   dir: join(home, ".codex",   "skills"), agentDir: join(home, ".codex",   "agents"), commandDir: join(home, ".codex",   "commands"), platform: "codex"   },
  { name: "cursor",  dir: join(home, ".cursor",  "skills"), agentDir: join(home, ".cursor",  "agents"), commandDir: join(home, ".cursor",  "commands"), platform: "cursor"  },
  { name: "kiro",    dir: join(home, ".kiro",    "skills"), agentDir: join(home, ".kiro",    "agents"), commandDir: join(home, ".kiro",    "commands"), platform: "kiro"    },
];

// --- arg parsing -----------------------------------------------------------

const args = argv.slice(2);
const subcommand = args[0] && !args[0].startsWith("-") ? args[0] : "install";
const flags = args.filter(a => a.startsWith("--"));
const flagValue = (name) => {
  const f = flags.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!f) return null;
  return f.includes("=") ? f.split("=")[1] : true;
};

const force         = !!flagValue("force");
const skipSelfTest  = !!flagValue("skip-self-test");
const jsonOut       = !!flagValue("json");
const cliArg        = flagValue("cli");
const pathArg       = flagValue("path");

function resolveTargets() {
  if (pathArg && typeof pathArg === "string") {
    const customPath = resolve(pathArg.replace(/^~/, home));
    const dirName = basename(customPath).replace(/^\./, "");
    const known = CLI_TARGETS.find(t => t.name === dirName);
    return [{
      name: dirName,
      dir: join(customPath, "skills"),
      agentDir: join(customPath, "agents"),
      commandDir: join(customPath, "commands"),
      platform: known?.platform ?? dirName,
    }];
  }
  const detected = CLI_TARGETS.filter(t => existsSync(resolve(t.dir, "..")));
  if (cliArg && typeof cliArg === "string") {
    const filter = cliArg.split(",");
    return detected.filter(t => filter.includes(t.name));
  }
  return detected;
}

// --- helpers ---------------------------------------------------------------

function installedVersion(target) {
  const marker = join(target.dir, INSTALLED_MARKER);
  if (!existsSync(marker)) return null;
  try { return readFileSync(marker, "utf8").trim(); } catch { return null; }
}

function writeMarker(target) {
  mkdirSync(target.dir, { recursive: true });
  writeFileSync(join(target.dir, INSTALLED_MARKER), VERSION);
}

function readdirSafe(p) { try { return readdirSync(p); } catch { return []; } }

function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true, force: true });
}

// --- subcommands -----------------------------------------------------------

function cmdVersion() {
  if (jsonOut) {
    console.log(JSON.stringify({ name: PKG.name, version: VERSION }));
  } else {
    console.log(`wicked-testing ${VERSION}`);
  }
}

function cmdHelp() {
  console.log(`wicked-testing ${VERSION}

Usage: wicked-testing <command> [options]

Commands:
  install       Copy skills, agents, and commands into detected AI CLI dirs (default)
  update        Re-install over the existing deployment (idempotent)
  uninstall     Remove all wicked-testing files from detected AI CLI dirs
  status        Show installed version per CLI target
  doctor        Diagnose environment (Node version, detected CLIs, SQLite binding)
  version       Print package version
  help          This message

Options:
  --cli=<list>        Comma-separated CLI names (claude, gemini, copilot, codex, cursor, kiro)
  --path=<dir>        Custom target path (e.g. --path=~/.claude)
  --force             Overwrite even if versions match
  --skip-self-test    Skip the SQLite bootstrap self-test (install/update only)
  --json              Machine-readable output where supported

Examples:
  npx wicked-testing install
  npx wicked-testing status --json
  npx wicked-testing uninstall --cli=claude
  npx wicked-testing doctor
`);
}

function cmdStatus() {
  const targets = resolveTargets();
  const report = targets.map(t => {
    const installed = installedVersion(t);
    return {
      cli: t.name,
      dir: resolve(t.dir, ".."),
      installed_version: installed,
      current_version: VERSION,
      up_to_date: installed === VERSION,
      present: existsSync(t.dir),
    };
  });
  if (jsonOut) {
    console.log(JSON.stringify({ version: VERSION, targets: report }, null, 2));
    return;
  }
  console.log(`wicked-testing ${VERSION} — status\n`);
  if (report.length === 0) {
    console.log("No AI CLI directories detected.");
    return;
  }
  for (const r of report) {
    const tag = r.installed_version === null
      ? "not installed"
      : r.up_to_date ? "up to date" : `installed ${r.installed_version} (stale)`;
    console.log(`  ${r.cli.padEnd(10)} ${tag}`);
  }
}

async function cmdDoctor() {
  const issues = [];
  const nodeVer = process.versions.node.split(".").map(Number);
  if (nodeVer[0] < 18) issues.push(`Node ${process.versions.node} — need >= 18`);
  const detected = CLI_TARGETS.filter(t => existsSync(resolve(t.dir, "..")));
  if (detected.length === 0) issues.push("No AI CLIs detected in home directory");
  let sqliteOk = false;
  try { await import("better-sqlite3"); sqliteOk = true; } catch (e) { issues.push(`better-sqlite3 load failed: ${e.message}`); }
  if (jsonOut) {
    console.log(JSON.stringify({
      node: process.versions.node,
      detected_clis: detected.map(d => d.name),
      sqlite_ok: sqliteOk,
      issues,
      healthy: issues.length === 0,
    }, null, 2));
    return;
  }
  console.log(`wicked-testing ${VERSION} — doctor`);
  console.log(`  Node:           ${process.versions.node}`);
  console.log(`  Detected CLIs:  ${detected.map(d => d.name).join(", ") || "(none)"}`);
  console.log(`  better-sqlite3: ${sqliteOk ? "ok" : "FAIL"}`);
  if (issues.length) {
    console.log("\nIssues:");
    for (const i of issues) console.log(`  - ${i}`);
    exit(1);
  } else {
    console.log("\nAll good.");
  }
}

async function cmdInstall({ mode }) {
  const targets = resolveTargets();
  if (targets.length === 0) {
    console.error("No AI CLIs detected. Supported: " + CLI_TARGETS.map(t => t.name).join(", "));
    console.error("Use --path=<dir> to target a custom location.");
    exit(1);
  }

  const skillsSrc = join(__dirname, "skills");
  const agentsSrc = join(__dirname, "agents");
  const commandsSrc = join(__dirname, "commands");

  const skillDirs = readdirSafe(skillsSrc).filter(d => !d.startsWith("."));
  const agentFiles = readdirSafe(agentsSrc).filter(f => f.endsWith(".md"));
  const specialistsSrc = join(agentsSrc, "specialists");
  const specialistFiles = readdirSafe(specialistsSrc).filter(f => f.endsWith(".md"));
  const commandFiles = readdirSafe(commandsSrc).filter(f => f.endsWith(".md"));

  let totalSkills = 0, totalAgents = 0, totalCommands = 0;

  for (const target of targets) {
    const existing = installedVersion(target);
    if (existing === VERSION && !force && mode !== "update") {
      console.log(`[${target.name}] already at ${VERSION}, skipping (--force to overwrite)`);
      continue;
    }

    mkdirSync(target.dir, { recursive: true });
    for (const skill of skillDirs) copyTree(join(skillsSrc, skill), join(target.dir, `wicked-testing-${skill}`));
    totalSkills += skillDirs.length;

    if (target.agentDir) {
      mkdirSync(target.agentDir, { recursive: true });
      for (const f of agentFiles) cpSync(join(agentsSrc, f), join(target.agentDir, `wicked-testing-${f}`), { force: true });
      for (const f of specialistFiles) cpSync(join(specialistsSrc, f), join(target.agentDir, `wicked-testing-${f}`), { force: true });
      totalAgents += agentFiles.length + specialistFiles.length;
    }

    if (target.commandDir) {
      const cmdDir = join(target.commandDir, "wicked-testing");
      mkdirSync(cmdDir, { recursive: true });
      for (const f of commandFiles) cpSync(join(commandsSrc, f), join(cmdDir, f), { force: true });
      totalCommands += commandFiles.length;
    }

    writeMarker(target);
    console.log(`[${target.name}] installed ${VERSION} (skills=${skillDirs.length} agents=${agentFiles.length}+${specialistFiles.length} commands=${commandFiles.length})`);
  }

  if (!skipSelfTest && mode !== "update") {
    const ok = await selfTest();
    if (!ok) {
      console.error("Self-test failed. Files were copied, but SQLite is not healthy.");
      console.error("Run `npx wicked-testing doctor` for diagnostics.");
      exit(1);
    }
  }

  if (jsonOut) {
    console.log(JSON.stringify({ version: VERSION, targets: targets.map(t => t.name), skills: totalSkills, agents: totalAgents, commands: totalCommands }));
  }
}

function cmdUninstall() {
  const targets = resolveTargets();
  if (targets.length === 0) {
    console.error("No AI CLIs detected.");
    exit(1);
  }
  const agentsSrc = join(__dirname, "agents");
  const skillDirs = readdirSafe(join(__dirname, "skills")).filter(d => !d.startsWith("."));
  const agentFiles = readdirSafe(agentsSrc).filter(f => f.endsWith(".md"));
  const specialistFiles = readdirSafe(join(agentsSrc, "specialists")).filter(f => f.endsWith(".md"));

  for (const target of targets) {
    let removed = 0;
    for (const skill of skillDirs) {
      const p = join(target.dir, `wicked-testing-${skill}`);
      if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); removed++; }
    }
    if (target.agentDir) {
      for (const f of agentFiles) {
        const p = join(target.agentDir, `wicked-testing-${f}`);
        if (existsSync(p)) { rmSync(p, { force: true }); removed++; }
      }
      for (const f of specialistFiles) {
        const p = join(target.agentDir, `wicked-testing-${f}`);
        if (existsSync(p)) { rmSync(p, { force: true }); removed++; }
      }
    }
    if (target.commandDir) {
      const cmdDir = join(target.commandDir, "wicked-testing");
      if (existsSync(cmdDir)) { rmSync(cmdDir, { recursive: true, force: true }); removed++; }
    }
    const marker = join(target.dir, INSTALLED_MARKER);
    if (existsSync(marker)) rmSync(marker, { force: true });
    console.log(`[${target.name}] uninstalled — ${removed} item${removed === 1 ? "" : "s"} removed`);
  }
}

// --- self-test (kept from original, trimmed) -------------------------------

async function selfTest() {
  try {
    const { DomainStore } = await import("./lib/domain-store.mjs");
    const bootstrapDir = join(cwd(), ".wicked-testing-bootstrap");
    try { rmSync(bootstrapDir, { recursive: true, force: true }); } catch {}
    mkdirSync(bootstrapDir, { recursive: true });
    const store = new DomainStore(bootstrapDir);
    const project = store.create("projects", {
      name: "wicked-testing-bootstrap",
      description: "Bootstrap self-test project",
    });
    const scenario = store.create("scenarios", {
      project_id: project.id,
      name: "bootstrap-self-test",
      format_version: "1.0",
      body: "Bootstrap scenario",
    });
    const now = new Date().toISOString();
    const run = store.create("runs", { project_id: project.id, scenario_id: scenario.id, started_at: now, status: "running" });
    store.update("runs", run.id, { finished_at: new Date().toISOString(), status: "passed" });
    store.create("verdicts", { run_id: run.id, verdict: "PASS", reviewer: "bootstrap", reason: "self-test" });
    store.close();
    try { rmSync(bootstrapDir, { recursive: true, force: true }); } catch {}
    return true;
  } catch (e) {
    console.warn("  self-test: " + e.message);
    return false;
  }
}

// --- dispatch --------------------------------------------------------------

(async () => {
  switch (subcommand) {
    case "install":   await cmdInstall({ mode: "install" }); break;
    case "update":    await cmdInstall({ mode: "update" });  break;
    case "uninstall": cmdUninstall();                         break;
    case "status":    cmdStatus();                            break;
    case "doctor":    await cmdDoctor();                      break;
    case "version":
    case "--version":
    case "-v":        cmdVersion();                           break;
    case "help":
    case "--help":
    case "-h":        cmdHelp();                              break;
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      cmdHelp();
      exit(1);
  }
})();
