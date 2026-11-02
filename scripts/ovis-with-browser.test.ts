import { describe, expect, it } from "bun:test";
import { mergeEnv, parseSetupArguments, pluginSettings, setup, type SetupDeps, type SetupIo } from "./ovis-with-browser.ts";
import { planTailnet, servedPorts, type ServeStatus } from "./ovis-tailnet.ts";

const status = (entries: Record<number, string>): ServeStatus => ({
  TCP: Object.fromEntries(Object.keys(entries).map((port) => [port, { HTTPS: true }])),
  Web: Object.fromEntries(Object.entries(entries).map(([port, proxy]) => [`pc.ts.net:${port}`, { Handlers: { "/": { Proxy: proxy } } }])),
});
const target = "http://127.0.0.1:7318";

describe("tailnet plan", () => {
  it("reads which ports are served and to what", () => {
    expect([...servedPorts(status({ 443: "http://127.0.0.1:17317", 8443: target }))]).toEqual([[443, "http://127.0.0.1:17317"], [8443, target]]);
  });
  it("leaves the tailnet alone on skip", () => {
    expect(planTailnet("skip", status({}), 7318).command).toBeNull();
  });
  it("serves the existing address when it is free", () => {
    expect(planTailnet("existing", status({}), 7318).command).toEqual(["serve", "--bg", "--https=443", target]);
  });
  it("refuses to replace what the existing address serves without --force", () => {
    const refused = planTailnet("existing", status({ 443: "http://127.0.0.1:17317" }), 7318);
    expect(refused.command).toBeNull();
    expect(refused.httpsPort).toBeNull();
    expect(refused.replaces).toBe("http://127.0.0.1:17317");
    expect(planTailnet("existing", status({ 443: "http://127.0.0.1:17317" }), 7318, { force: true }).command).toEqual(["serve", "--bg", "--https=443", target]);
  });
  it("does nothing when the address already serves this server", () => {
    expect(planTailnet("existing", status({ 443: target }), 7318)).toMatchObject({ command: null, httpsPort: 443 });
    expect(planTailnet("separate", status({ 8443: target }), 7318)).toMatchObject({ command: null, httpsPort: 8443 });
  });
  it("picks the first free separate port, or the one asked for", () => {
    expect(planTailnet("separate", status({ 443: "http://127.0.0.1:17317", 8443: "http://127.0.0.1:9" }), 7318).command).toEqual(["serve", "--bg", "--https=8444", target]);
    expect(planTailnet("separate", status({}), 7318, { httpsPort: 9000 }).command).toEqual(["serve", "--bg", "--https=9000", target]);
    expect(planTailnet("separate", status({ 9000: "http://127.0.0.1:9" }), 7318, { httpsPort: 9000 }).command).toBeNull();
  });
});

describe("setup arguments", () => {
  it("defaults to asking, port 7318", () => {
    expect(parseSetupArguments(["setup"])).toEqual({ plugin: true, ref: null, skill: null, tailnet: null, port: 7318, force: false, yes: false });
  });
  it("takes the choices as flags", () => {
    expect(parseSetupArguments(["setup", "--skill", "--tailnet", "separate", "--https-port", "9000", "--port", "7400", "--force", "--yes"]))
      .toEqual({ plugin: true, ref: null, skill: true, tailnet: "separate", port: 7400, httpsPort: 9000, force: true, yes: true });
    expect(parseSetupArguments(["setup", "--no-plugin", "--ref", "v0.1.0"])).toMatchObject({ plugin: false, ref: "v0.1.0" });
    expect(parseSetupArguments(["setup", "--no-skill"]).skill).toBe(false);
  });
  it("rejects what it does not know", () => {
    expect(() => parseSetupArguments(["setup", "--tailnet", "all"])).toThrow("existing, separate or skip");
    expect(() => parseSetupArguments(["setup", "--port", "x"])).toThrow("port number");
    expect(() => parseSetupArguments(["go"])).toThrow("Unknown command");
  });
});

describe("setup", () => {
  const run = async (args: string[], answers: string[], serve: ServeStatus = {}, tailscale = true, herdr: { listed?: string; install?: boolean; env?: string; up?: boolean; stopped?: boolean } = {}) => {
    const lines: string[] = [];
    const ran: string[][] = [];
    const herdrCalls: string[][] = [];
    const written: Record<string, string> = {};
    let skillWrites = 0;
    const io: SetupIo = { say: (line) => lines.push(line), ask: async (_q, _c, fallback) => answers.shift() ?? fallback };
    const deps: SetupDeps = {
      herdr: (command) => {
        herdrCalls.push(command);
        if (command[1] === "list") return { ok: true, output: herdr.listed ?? "0 plugins installed." };
        if (command[1] === "install") return { ok: herdr.install ?? true, output: herdr.install === false ? "no such repo" : "" };
        if (herdr.stopped) return { ok: false, output: '{"error":{"code":"server_not_running"}}' };
        return { ok: true, output: "" };
      },
      configDir: () => "/cfg/icingrain.ovis-with-browser",
      readEnv: () => herdr.env ?? "",
      writeEnv: (file, text) => { written[file] = text; },
      home: "/home/u",
      serverUp: async () => herdr.up ?? true,
      installSkill: (write) => { if (write) skillWrites++; return [{ agent: "agents", file: "/h/.agents/skills/ovis-browser/SKILL.md", action: "installed" }]; },
      chrome: () => "/Applications/Google Chrome.app",
      serve: () => ({ status: serve, available: tailscale }),
      runTailscale: (command) => { ran.push(command); return { ok: true, output: "" }; },
      origin: (port) => `https://pc.ts.net${port === 443 ? "" : `:${port}`}`,
    };
    const code = await setup(parseSetupArguments(["setup", ...args]), io, deps);
    return { code, lines: lines.join("\n"), ran, skillWrites, herdrCalls, written };
  };

  it("asks, installs the skill and serves a separate address", async () => {
    const result = await run([], ["y", "separate"]);
    expect(result.code).toBe(0);
    expect(result.skillWrites).toBe(1);
    expect(result.ran).toEqual([["serve", "--bg", "--https=8443", target]]);
    expect(result.lines).toContain("https://pc.ts.net:8443");
  });
  it("with --yes and no choices writes the skill and touches no tailnet address", async () => {
    const result = await run(["--yes"], []);
    expect(result.skillWrites).toBe(1);
    expect(result.ran).toEqual([]);
  });
  it("writes no skill on --no-skill", async () => {
    expect((await run(["--no-skill", "--tailnet", "skip"], [])).skillWrites).toBe(0);
  });
  it("fails and runs nothing when the existing address is taken", async () => {
    const result = await run(["--no-skill", "--tailnet", "existing"], [], status({ 443: "http://127.0.0.1:17317" }));
    expect(result.code).toBe(1);
    expect(result.ran).toEqual([]);
    expect(result.lines).toContain("already serves http://127.0.0.1:17317");
  });
  it("says so when Tailscale is missing", async () => {
    const result = await run(["--no-skill", "--tailnet", "separate"], [], {}, false);
    expect(result.code).toBe(1);
    expect(result.lines).toContain("Tailscale was not found");
  });

  it("installs the plugin, writes its settings, starts it and says where it runs", async () => {
    const result = await run(["--no-skill", "--tailnet", "skip"], []);
    expect(result.code).toBe(0);
    expect(result.herdrCalls).toEqual([
      ["plugin", "list"],
      ["plugin", "install", "icingrain/ovis-with-browser", "-y"],
      ["plugin", "action", "invoke", "start", "--plugin", "icingrain.ovis-with-browser"],
    ]);
    expect(result.written["/cfg/icingrain.ovis-with-browser/env"]).toBe("PORT=7318\nOVIS_STATE_DIR=/home/u/.local/state/ovis-with-browser\n");
    expect(result.lines).toContain("Running at http://127.0.0.1:7318");
  });
  it("does not install again, and keeps settings that are already there", async () => {
    const result = await run(["--no-skill", "--tailnet", "skip", "--ref", "v1"], [], {}, true, { listed: "1 plugin installed:\n- icingrain.ovis-with-browser (Ovis with Browser) enabled", env: "PORT=9000\nOVIS_STATE_DIR=/x\n" });
    expect(result.herdrCalls.map((call) => call[1])).toEqual(["list", "action"]);
    expect(result.written).toEqual({});
    expect(result.lines).toContain("Settings in /cfg/icingrain.ovis-with-browser/env are kept.");
  });
  it("passes --ref on an install and stops when the install fails", async () => {
    const result = await run(["--no-skill", "--tailnet", "skip", "--ref", "v1"], [], {}, true, { install: false });
    expect(result.code).toBe(1);
    expect(result.herdrCalls[1]).toEqual(["plugin", "install", "icingrain/ovis-with-browser", "-y", "--ref", "v1"]);
    expect(result.written).toEqual({});
    expect(result.lines).toContain("The install failed");
  });
  it("fails when the server does not answer after the start", async () => {
    const result = await run(["--no-skill", "--tailnet", "skip"], [], {}, true, { up: false });
    expect(result.code).toBe(1);
    expect(result.lines).toContain("nothing answers on port 7318");
  });
  it("installs and configures while herdr is not running, and says it starts with herdr", async () => {
    const result = await run(["--no-skill", "--tailnet", "skip"], [], {}, true, { stopped: true });
    expect(result.code).toBe(0);
    expect(result.lines).toContain("it starts with herdr the next time");
    expect(Object.keys(result.written)).toEqual(["/cfg/icingrain.ovis-with-browser/env"]);
  });
  it("leaves the plugin alone with --no-plugin", async () => {
    const result = await run(["--no-plugin", "--no-skill", "--tailnet", "skip"], []);
    expect(result.herdrCalls).toEqual([]);
    expect(result.code).toBe(0);
  });
});

describe("plugin settings", () => {
  it("keeps the plugin's own port and state apart from an Ovis install", () => {
    expect(pluginSettings(7318, "/home/u")).toEqual({ PORT: "7318", OVIS_STATE_DIR: "/home/u/.local/state/ovis-with-browser" });
  });
  it("adds only the keys that are missing and keeps the rest of the file", () => {
    expect(mergeEnv("", { PORT: "7318", A: "1" })).toEqual({ text: "PORT=7318\nA=1\n", added: ["PORT", "A"] });
    expect(mergeEnv("# mine\nPORT=9000", { PORT: "7318", A: "1" })).toEqual({ text: "# mine\nPORT=9000\nA=1\n", added: ["A"] });
    expect(mergeEnv("PORT=9000\nA=1\n", { PORT: "7318", A: "1" })).toEqual({ text: "PORT=9000\nA=1\n", added: [] });
  });
});
