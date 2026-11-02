/**
 * Puts the Ovis server on a Tailscale HTTPS address, either the tailnet address that is already in use
 * (port 443) or a separate one (another HTTPS port), so a mobile device can open it and install it as an app.
 *
 * The plan is pure: `planTailnet` reads `tailscale serve status --json` and says which command to run,
 * or why none can be run, so it is tested without a Tailscale.
 */
import { spawnSync } from "node:child_process";

export type TailnetMode = "existing" | "separate" | "skip";

export interface ServeHandlers { Handlers?: Record<string, { Proxy?: string }> }
export interface ServeStatus { TCP?: Record<string, unknown>; Web?: Record<string, ServeHandlers> }

export interface TailnetPlan {
  /** the arguments for `tailscale`; null when nothing is to be run */
  command: string[] | null;
  /** the HTTPS port the server is reached on */
  httpsPort: number | null;
  /** what to tell the person, whether or not a command runs */
  message: string;
  /** true when the command replaces what another service already serves on that port */
  replaces?: string;
}

const SEPARATE_PORTS = [8443, 8444, 8445, 10000];

/** the ports `tailscale serve` already fronts, with the target of each `/` handler */
export function servedPorts(status: ServeStatus): Map<number, string> {
  const served = new Map<number, string>();
  for (const port of Object.keys(status.TCP ?? {})) served.set(Number(port), "");
  for (const [host, entry] of Object.entries(status.Web ?? {})) {
    const port = Number(host.slice(host.lastIndexOf(":") + 1));
    if (Number.isInteger(port)) served.set(port, entry.Handlers?.["/"]?.Proxy ?? "");
  }
  return served;
}

export function planTailnet(mode: TailnetMode, status: ServeStatus, serverPort: number, options: { httpsPort?: number; force?: boolean } = {}): TailnetPlan {
  const target = `http://127.0.0.1:${serverPort}`;
  if (mode === "skip") return { command: null, httpsPort: null, message: "Tailnet address left alone." };
  const served = servedPorts(status);
  if (mode === "existing") {
    const current = served.get(443);
    if (current === target) return { command: null, httpsPort: 443, message: "The tailnet address already serves this server." };
    if (current !== undefined && current !== "" && !options.force) {
      return { command: null, httpsPort: null, message: `The tailnet address (port 443) already serves ${current}. Choose a separate address, or pass --force to replace it.`, replaces: current };
    }
    return { command: ["serve", "--bg", "--https=443", target], httpsPort: 443, message: "Serving this server on the existing tailnet address.", ...(current ? { replaces: current } : {}) };
  }
  const wanted = options.httpsPort;
  if (wanted !== undefined) {
    const current = served.get(wanted);
    if (current === target) return { command: null, httpsPort: wanted, message: `Port ${wanted} already serves this server.` };
    if (current !== undefined && current !== "" && !options.force) {
      return { command: null, httpsPort: null, message: `Port ${wanted} already serves ${current}. Pick another port, or pass --force to replace it.`, replaces: current };
    }
    return { command: ["serve", "--bg", `--https=${wanted}`, target], httpsPort: wanted, message: `Serving this server on a separate tailnet address, port ${wanted}.` };
  }
  const already = [...served].find(([, proxy]) => proxy === target);
  if (already) return { command: null, httpsPort: already[0], message: `Port ${already[0]} already serves this server.` };
  const free = SEPARATE_PORTS.find((port) => !served.has(port));
  if (free === undefined) return { command: null, httpsPort: null, message: `No free HTTPS port among ${SEPARATE_PORTS.join(", ")}; pass --https-port <port>.` };
  return { command: ["serve", "--bg", `--https=${free}`, target], httpsPort: free, message: `Serving this server on a separate tailnet address, port ${free}.` };
}

/** `tailscale serve status --json`; an empty status when Tailscale is missing or serves nothing */
export function readServeStatus(tailscale = "tailscale"): { status: ServeStatus; available: boolean } {
  const result = spawnSync(tailscale, ["serve", "status", "--json"], { encoding: "utf8", timeout: 8000 });
  if (result.error || result.status !== 0) return { status: {}, available: false };
  try {
    return { status: JSON.parse(result.stdout || "{}") as ServeStatus, available: true };
  } catch {
    return { status: {}, available: true };
  }
}

/** the HTTPS name of this PC on the tailnet (`https://<name>[:port]`), or null */
export function tailnetOrigin(httpsPort: number, tailscale = "tailscale"): string | null {
  const result = spawnSync(tailscale, ["status", "--json"], { encoding: "utf8", timeout: 8000 });
  if (result.error || result.status !== 0) return null;
  try {
    const name = (JSON.parse(result.stdout) as { Self?: { DNSName?: string } }).Self?.DNSName?.replace(/\.$/, "");
    return name ? `https://${name}${httpsPort === 443 ? "" : `:${httpsPort}`}` : null;
  } catch {
    return null;
  }
}

export function runTailscale(args: string[], tailscale = "tailscale"): { ok: boolean; output: string } {
  const result = spawnSync(tailscale, args, { encoding: "utf8", timeout: 60_000 });
  return { ok: !result.error && result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
}
