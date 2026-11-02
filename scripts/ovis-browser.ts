/**
 * Starts a Chrome the Ovis Browser tab can show and registers it for the herdr pane this runs in, so
 * an agent that drives that Chrome over its DevTools port is watched (and steered) from Ovis.
 *
 *   ovis-browser.ts start [--url <page>]   launch (or reuse) this pane's Chrome and register it
 *   ovis-browser.ts status                 what is registered for the pane, and whether it answers
 *   ovis-browser.ts stop                   unregister and close the Chrome this script started
 *
 * The pane is $HERDR_PANE_ID (or --pane), the server is $OVIS_URL (default http://127.0.0.1:7318),
 * with $OVIS_TOKEN as a Bearer token when the server asks for one. The Chrome is $CHROME_PATH or the
 * first one found; it gets its own profile, never the one a person browses with.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_OVIS_URL = "http://127.0.0.1:7318";

export interface BrowserHelperOptions {
  command: "start" | "status" | "stop";
  pane: string;
  ovis: string;
  token: string | null;
  url: string;
  chrome: string | null;
}

/** The options for an argument list and environment; throws a message fit to print. */
export function parseBrowserArguments(args: string[], env: Record<string, string | undefined>): BrowserHelperOptions {
  const [command = "start", ...rest] = args;
  if (command !== "start" && command !== "status" && command !== "stop") throw new Error(`Unknown command: ${command} (use start, status or stop)`);
  const options: BrowserHelperOptions = {
    command, pane: env["HERDR_PANE_ID"] ?? "", ovis: (env["OVIS_URL"] || DEFAULT_OVIS_URL).replace(/\/+$/, ""),
    token: env["OVIS_TOKEN"] || null, url: "about:blank", chrome: env["CHROME_PATH"] || null,
  };
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index]!;
    const value = () => {
      const next = rest[++index];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === "--pane") options.pane = value();
    else if (arg === "--ovis") options.ovis = value().replace(/\/+$/, "");
    else if (arg === "--url") options.url = value();
    else if (arg === "--chrome") options.chrome = value();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.pane) throw new Error("This is not a herdr pane (HERDR_PANE_ID is unset); pass --pane <pane id>");
  return options;
}

/** The places a Chrome usually is, in the order to try them. */
export function chromeCandidates(platform: NodeJS.Platform, env: Record<string, string | undefined>): string[] {
  if (platform === "darwin") return [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ];
  if (platform === "win32") {
    const roots = [env["PROGRAMFILES"], env["PROGRAMFILES(X86)"], env["LOCALAPPDATA"]].filter((root): root is string => !!root);
    return roots.map((root) => join(root, "Google", "Chrome", "Application", "chrome.exe"));
  }
  return ["/opt/google/chrome/chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
}

export function findChrome(options: Pick<BrowserHelperOptions, "chrome">, platform: NodeJS.Platform = process.platform, env: Record<string, string | undefined> = process.env, exists: (path: string) => boolean = existsSync): string {
  if (options.chrome) {
    if (!exists(options.chrome)) throw new Error(`Chrome not found at ${options.chrome}`);
    return options.chrome;
  }
  const found = chromeCandidates(platform, env).find(exists);
  if (!found) throw new Error("No Chrome found; set CHROME_PATH to one");
  return found;
}

/** The directory of one pane's Chrome profile and state, apart from the profile a person browses with. */
export function profileDirectory(pane: string, home: string = homedir()): string {
  return join(home, ".ovis-browser", pane.replace(/[^A-Za-z0-9_.-]/g, "_"));
}

interface HelperState { pid: number; port: number }

const readState = (directory: string): HelperState | null => {
  try {
    const state = JSON.parse(readFileSync(join(directory, "state.json"), "utf8")) as Partial<HelperState>;
    return typeof state.pid === "number" && typeof state.port === "number" ? { pid: state.pid, port: state.port } : null;
  } catch {
    return null;
  }
};

const api = (options: BrowserHelperOptions, path: string, init: RequestInit = {}) => fetch(`${options.ovis}${path}`, {
  ...init, headers: { ...(options.token ? { authorization: `Bearer ${options.token}` } : {}), ...(init.body ? { "content-type": "application/json" } : {}) },
});
const paneQuery = (options: BrowserHelperOptions) => `?pane_id=${encodeURIComponent(options.pane)}`;

async function ovisError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return `Ovis answered ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}${response.status === 401 || response.status === 403 ? " (set OVIS_TOKEN, or run this on the PC that runs Ovis)" : ""}`;
}

async function cdpAnswers(port: number): Promise<boolean> {
  try {
    return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

async function registered(options: BrowserHelperOptions): Promise<{ cdpUrl: string } | null> {
  const response = await api(options, `/api/pane/browser${paneQuery(options)}`);
  if (!response.ok) throw new Error(await ovisError(response));
  const body = await response.json() as { session: { cdpUrl: string } | null };
  return body.session;
}

function freePort(): number {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = probe.port!;
  probe.stop(true);
  return port;
}

export async function start(options: BrowserHelperOptions): Promise<string> {
  let session: { cdpUrl: string } | null;
  try {
    session = await registered(options);
  } catch (error) {
    throw new Error(`Cannot reach Ovis at ${options.ovis}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (session) {
    const port = Number(new URL(session.cdpUrl).port);
    if (await cdpAnswers(port)) return session.cdpUrl;
    await api(options, `/api/pane/browser${paneQuery(options)}`, { method: "DELETE" });
  }
  const directory = profileDirectory(options.pane);
  mkdirSync(directory, { recursive: true });
  const port = freePort();
  const chrome = spawn(findChrome(options), [
    `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1", `--user-data-dir=${join(directory, "chrome")}`,
    "--no-first-run", "--no-default-browser-check", options.url,
  ], { detached: true, stdio: "ignore" });
  chrome.unref();
  const deadline = Date.now() + 15_000;
  while (!(await cdpAnswers(port))) {
    if (Date.now() > deadline) {
      try { process.kill(chrome.pid!); } catch { /* already gone */ }
      throw new Error("Chrome did not open its debugging port in time");
    }
    await Bun.sleep(100);
  }
  writeFileSync(join(directory, "state.json"), JSON.stringify({ pid: chrome.pid, port } satisfies Partial<HelperState>));
  const cdpUrl = `http://127.0.0.1:${port}`;
  const response = await api(options, "/api/pane/browser/register", { method: "POST", body: JSON.stringify({ pane_id: options.pane, cdp_url: cdpUrl }) });
  if (!response.ok) {
    try { process.kill(chrome.pid!); } catch { /* already gone */ }
    rmSync(join(directory, "state.json"), { force: true });
    throw new Error(await ovisError(response));
  }
  return cdpUrl;
}

export async function stop(options: BrowserHelperOptions): Promise<string> {
  const directory = profileDirectory(options.pane);
  const state = readState(directory);
  const response = await api(options, `/api/pane/browser${paneQuery(options)}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await ovisError(response));
  if (state) {
    try { process.kill(state.pid); } catch { /* already gone */ }
    rmSync(join(directory, "state.json"), { force: true });
  }
  return state ? "Unregistered and closed the Chrome this script started." : "Unregistered (no Chrome of this script's to close).";
}

export async function status(options: BrowserHelperOptions): Promise<string> {
  const session = await registered(options);
  if (!session) return "No browser is registered for this pane.";
  return `${session.cdpUrl} is registered for ${options.pane} and ${await cdpAnswers(Number(new URL(session.cdpUrl).port)) ? "answers" : "does not answer"}.`;
}

if (import.meta.main) {
  try {
    const options = parseBrowserArguments(Bun.argv.slice(2), process.env);
    if (options.command === "start") {
      const cdpUrl = await start(options);
      console.log(`cdp_url: ${cdpUrl}`);
      console.log("Drive this Chrome through that DevTools URL; the pane's Browser tab in Ovis shows and steers the same tab.");
    } else console.log(await (options.command === "stop" ? stop(options) : status(options)));
  } catch (error) {
    console.error(`ovis-browser: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
