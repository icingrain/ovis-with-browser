#!/usr/bin/env bun
/**
 * Sets up the Ovis Browser tab on this computer, step by step:
 *
 *   1. the ovis-browser helper (this package puts it on PATH; setup checks it and Chrome are found)
 *   2. the ovis-browser skill, so an agent registers its own Chrome (optional)
 *   3. a tailnet address, so a mobile device can open Ovis: the existing one, a separate one, or none
 *
 *   ovis-with-browser setup [--skill | --no-skill] [--tailnet existing|separate|skip]
 *                           [--port 7318] [--https-port 8443] [--force] [--yes]
 *
 * Without a flag, setup asks (when it runs in a terminal) and otherwise takes the safe answer: no skill is
 * written without --skill, and no tailnet address is touched without --tailnet.
 */
import { createInterface } from "node:readline/promises";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { installBrowserSkill, type SkillResult } from "./install-browser-skill.ts";
import { findChrome } from "./ovis-browser.ts";
import { planTailnet, readServeStatus, runTailscale, tailnetOrigin, type TailnetMode, type TailnetPlan, type ServeStatus } from "./ovis-tailnet.ts";

export interface SetupOptions {
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
  const options: SetupOptions = { skill: null, tailnet: null, port: 7318, force: false, yes: false };
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
    if (arg === "--skill") options.skill = true;
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

export interface SetupDeps {
  installSkill: (write: boolean) => SkillResult[];
  chrome: () => string | null;
  serve: () => { status: ServeStatus; available: boolean };
  runTailscale: (args: string[]) => { ok: boolean; output: string };
  origin: (httpsPort: number) => string | null;
}

export function defaultDeps(root: string): SetupDeps {
  return {
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
  io.say("1/3  ovis-browser helper");
  const chrome = deps.chrome();
  io.say(chrome ? `     Chrome found: ${chrome}` : "     No Chrome found; set CHROME_PATH to one before an agent starts a browser.");

  io.say("2/3  skill");
  const skill = options.skill ?? (options.yes ? true : (await io.ask("     Install the ovis-browser skill so agents register their own Chrome?", ["y", "n"], "y")) === "y");
  if (skill) {
    for (const result of deps.installSkill(true)) io.say(`     ${result.action.padEnd(10)} ${result.agent.padEnd(9)} ${result.file}${result.note ? `  (${result.note})` : ""}`);
    io.say("     Restart running agent sessions so they load it.");
  } else io.say("     Skipped.");

  io.say("3/3  tailnet address");
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
