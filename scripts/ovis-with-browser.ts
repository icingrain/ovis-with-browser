#!/usr/bin/env bun
/**
 * Sets up Ovis with Browser on this computer in one go:
 *
 *   1. the herdr plugin (installed from GitHub when it is not there) and its settings, then started
 *   2. the ovis-browser helper (this package puts it on PATH; setup checks Chrome is found)
 *   3. the ovis-browser skill, so an agent registers its own Chrome (optional)
 *   4. a tailnet address, so a mobile device can open Ovis: the existing one, a separate one, or none
 *
 *   ovis-with-browser setup [--skill | --no-skill] [--tailnet existing|separate|skip] [--no-plugin]
 *                           [--ref <tag>] [--port 7318] [--https-port 8443] [--force] [--yes]
 *
 * Without a flag, setup asks (when it runs in a terminal) and otherwise takes the safe answer: no skill is
 * written without --skill, and no tailnet address is touched without --tailnet. The plugin keeps its own
 * id and port, so an Ovis install beside it is left as it is.
 */
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { dirname, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { installBrowserSkill, type SkillResult } from "./install-browser-skill.ts";
import { findChrome } from "./ovis-browser.ts";
import { planTailnet, readServeStatus, runTailscale, tailnetOrigin, type TailnetMode, type TailnetPlan, type ServeStatus } from "./ovis-tailnet.ts";

export const PLUGIN_ID = "icingrain.ovis-with-browser";
export const PLUGIN_REPO = "icingrain/ovis-with-browser";

export interface SetupOptions {
  plugin: boolean;
  ref: string | null;
  skill: boolean | null;
  tailnet: TailnetMode | null;
  port: number;
  httpsPort?: number;
  force: boolean;
  yes: boolean;
}

export function parseSetupArguments(args: string[]): SetupOptions {
  const [command = "setup", ...rest] = args;
  if (command !== "setup") throw new Error(`Unknown command: ${command} (use setup)`);
  const options: SetupOptions = { plugin: true, ref: null, skill: null, tailnet: null, port: 7318, force: false, yes: false };
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index]!;
    const value = () => {
      const next = rest[++index];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    const port = (text: string) => {
      const number = Number(text);
      if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error(`${arg} takes a port number`);
      return number;
    };
    if (arg === "--no-plugin") options.plugin = false;
    else if (arg === "--ref") options.ref = value();
    else if (arg === "--skill") options.skill = true;
    else if (arg === "--no-skill") options.skill = false;
    else if (arg === "--tailnet") {
      const mode = value();
      if (mode !== "existing" && mode !== "separate" && mode !== "skip") throw new Error("--tailnet takes existing, separate or skip");
      options.tailnet = mode;
    } else if (arg === "--port") options.port = port(value());
    else if (arg === "--https-port") options.httpsPort = port(value());
    else if (arg === "--force") options.force = true;
    else if (arg === "--yes") options.yes = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export interface SetupIo {
  say(line: string): void;
  /** the answer to a question, or null when there is nobody to ask */
  ask(question: string, choices: string[], fallback: string): Promise<string>;
}

export function terminalIo(): SetupIo {
  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
  return {
    say: (line) => console.log(line),
    async ask(question, choices, fallback) {
      if (!interactive) return fallback;
      const readline = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = (await readline.question(`${question} [${choices.join("/")}] (${fallback}) `)).trim().toLowerCase();
        return choices.includes(answer) ? answer : fallback;
      } finally {
        readline.close();
      }
    },
  };
}

/** the settings the plugin runs with: its own port and state, apart from an Ovis install beside it */
export function pluginSettings(port: number, home: string): Record<string, string> {
  return { PORT: String(port), OVIS_STATE_DIR: join(home, ".local", "state", "ovis-with-browser") };
}

/** adds the keys the text does not set yet and keeps every line it has */
export function mergeEnv(existing: string, wanted: Record<string, string>): { text: string; added: string[] } {
  const set = new Set(existing.split("\n").map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#")).map((line) => line.slice(0, Math.max(line.indexOf("="), 0)).trim()));
  const added = Object.keys(wanted).filter((key) => !set.has(key));
  if (added.length === 0) return { text: existing, added };
  const base = existing === "" || existing.endsWith("\n") ? existing : `${existing}\n`;
  return { text: `${base}${added.map((key) => `${key}=${wanted[key]}`).join("\n")}\n`, added };
}

export interface SetupDeps {
  /** herdr plugin commands: the output, and whether herdr answered */
  herdr: (args: string[]) => { ok: boolean; output: string };
  /** the plugin's config directory, or null */
  configDir: () => string | null;
  readEnv: (file: string) => string;
  writeEnv: (file: string, text: string) => void;
  home: string;
  /** true once the server answers on the port */
  serverUp: (port: number) => Promise<boolean>;
  installSkill: (write: boolean) => SkillResult[];
  chrome: () => string | null;
  serve: () => { status: ServeStatus; available: boolean };
  runTailscale: (args: string[]) => { ok: boolean; output: string };
  origin: (httpsPort: number) => string | null;
}

export function defaultDeps(root: string): SetupDeps {
  const herdr = (args: string[]) => {
    const result = spawnSync("herdr", args, { encoding: "utf8", timeout: 600_000 });
    return { ok: !result.error && result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
  };
  return {
    herdr,
    configDir: () => {
      const result = herdr(["plugin", "config-dir", PLUGIN_ID]);
      return result.ok && result.output !== "" ? result.output.split("\n").pop()!.trim() : null;
    },
    readEnv: (file) => (existsSync(file) ? readFileSync(file, "utf8") : ""),
    writeEnv: (file, text) => { mkdirSync(dirname(file), { recursive: true, mode: 0o700 }); writeFileSync(file, text, { mode: 0o600 }); },
    home: homedir(),
    serverUp: async (port) => {
      for (let attempt = 0; attempt < 40; attempt++) {
        try {
          if ((await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) })).ok) return true;
        } catch { /* not up yet */ }
        await new Promise((resolveWait) => setTimeout(resolveWait, 500));
      }
      return false;
    },
    installSkill: (write) => installBrowserSkill({ root, write }),
    chrome: () => {
      try { return findChrome({ chrome: process.env["CHROME_PATH"] || null }); } catch { return null; }
    },
    serve: () => readServeStatus(),
    runTailscale: (args) => runTailscale(args),
    origin: (httpsPort) => tailnetOrigin(httpsPort),
  };
}

export async function setup(options: SetupOptions, io: SetupIo, deps: SetupDeps): Promise<number> {
  io.say("1/4  Ovis with Browser plugin");
  if (!options.plugin) io.say("     Skipped (--no-plugin).");
  else {
    const listed = deps.herdr(["plugin", "list"]);
    if (!listed.ok) {
      io.say("     herdr did not answer; install herdr (https://github.com/herdrdev/herdr) and run setup again.");
      return 1;
    }
    if (listed.output.includes(`- ${PLUGIN_ID} `)) io.say("     Already installed.");
    else {
      io.say("     Installing from GitHub; this builds the web app and can take a minute...");
      const installed = deps.herdr(["plugin", "install", PLUGIN_REPO, "-y", ...(options.ref ? ["--ref", options.ref] : [])]);
      if (!installed.ok) {
        io.say(`     The install failed:\n${installed.output.split("\n").map((line) => `       ${line}`).join("\n")}`);
        return 1;
      }
      io.say("     Installed.");
    }
    const dir = deps.configDir();
    if (dir === null) {
      io.say("     Cannot find the plugin's settings folder; set PORT and OVIS_STATE_DIR in its env file by hand.");
      return 1;
    }
    const file = join(dir, "env");
    const merged = mergeEnv(deps.readEnv(file), pluginSettings(options.port, deps.home));
    if (merged.added.length > 0) deps.writeEnv(file, merged.text);
    io.say(merged.added.length > 0 ? `     Settings written to ${file}: ${merged.added.join(", ")}.` : `     Settings in ${file} are kept.`);
    const started = deps.herdr(["plugin", "action", "invoke", "start", "--plugin", PLUGIN_ID]);
    if (!started.ok && started.output.includes("server_not_running")) {
      io.say("     herdr is not running, so the plugin was not started; it starts with herdr the next time you open it.");
    } else if (!started.ok) {
      io.say(`     Starting it failed:\n${started.output.split("\n").map((line) => `       ${line}`).join("\n")}`);
      return 1;
    } else if (await deps.serverUp(options.port)) io.say(`     Running at http://127.0.0.1:${options.port}`);
    else {
      io.say(`     Started, but nothing answers on port ${options.port} yet; check: herdr plugin log list --plugin ${PLUGIN_ID}`);
      return 1;
    }
  }

  io.say("2/4  ovis-browser helper");
  const chrome = deps.chrome();
  io.say(chrome ? `     Chrome found: ${chrome}` : "     No Chrome found; set CHROME_PATH to one before an agent starts a browser.");

  io.say("3/4  skill");
  const skill = options.skill ?? (options.yes ? true : (await io.ask("     Install the ovis-browser skill so agents register their own Chrome?", ["y", "n"], "y")) === "y");
  if (skill) {
    for (const result of deps.installSkill(true)) io.say(`     ${result.action.padEnd(10)} ${result.agent.padEnd(9)} ${result.file}${result.note ? `  (${result.note})` : ""}`);
    io.say("     Restart running agent sessions so they load it.");
  } else io.say("     Skipped.");

  io.say("4/4  tailnet address");
  const mode: TailnetMode = options.tailnet ?? (options.yes ? "skip" : (await io.ask("     Open Ovis on a mobile device through Tailscale?\n       existing = the tailnet address already in use, separate = another address, skip = no change\n    ", ["existing", "separate", "skip"], "skip")) as TailnetMode);
  const { status, available } = deps.serve();
  if (mode !== "skip" && !available) {
    io.say("     Tailscale was not found or is not running; start it, then run setup again with --tailnet.");
    return 1;
  }
  const plan: TailnetPlan = planTailnet(mode, status, options.port, { ...(options.httpsPort !== undefined ? { httpsPort: options.httpsPort } : {}), force: options.force });
  io.say(`     ${plan.message}`);
  if (plan.command === null) return mode !== "skip" && plan.httpsPort === null ? 1 : 0;
  const ran = deps.runTailscale(plan.command);
  if (!ran.ok) {
    io.say(`     tailscale ${plan.command.join(" ")} failed:\n${ran.output.split("\n").map((line) => `       ${line}`).join("\n")}`);
    return 1;
  }
  const origin = plan.httpsPort === null ? null : deps.origin(plan.httpsPort);
  if (origin) io.say(`     Open ${origin} on the mobile device.`);
  io.say(`     Undo with: tailscale serve --https=${plan.httpsPort} off`);
  return 0;
}

if (import.meta.main) {
  try {
    const options = parseSetupArguments(Bun.argv.slice(2));
    const root = resolve(dirname(import.meta.filename), "..");
    if (!existsSync(resolve(root, "integrations", "ovis-browser-skill.md"))) throw new Error("integrations/ovis-browser-skill.md is missing next to this script");
    process.exitCode = await setup(options, terminalIo(), defaultDeps(root));
  } catch (error) {
    console.error(`ovis-with-browser: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
