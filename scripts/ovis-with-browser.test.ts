import { describe, expect, it } from "bun:test";
import { parseSetupArguments, setup, type SetupDeps, type SetupIo } from "./ovis-with-browser.ts";
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
    expect(parseSetupArguments(["setup"])).toEqual({ skill: null, tailnet: null, port: 7318, force: false, yes: false });
  });
  it("takes the choices as flags", () => {
    expect(parseSetupArguments(["setup", "--skill", "--tailnet", "separate", "--https-port", "9000", "--port", "7400", "--force", "--yes"]))
      .toEqual({ skill: true, tailnet: "separate", port: 7400, httpsPort: 9000, force: true, yes: true });
    expect(parseSetupArguments(["setup", "--no-skill"]).skill).toBe(false);
  });
  it("rejects what it does not know", () => {
    expect(() => parseSetupArguments(["setup", "--tailnet", "all"])).toThrow("existing, separate or skip");
    expect(() => parseSetupArguments(["setup", "--port", "x"])).toThrow("port number");
    expect(() => parseSetupArguments(["go"])).toThrow("Unknown command");
  });
});

describe("setup", () => {
  const run = async (args: string[], answers: string[], serve: ServeStatus = {}, tailscale = true) => {
    const lines: string[] = [];
    const ran: string[][] = [];
    let skillWrites = 0;
    const io: SetupIo = { say: (line) => lines.push(line), ask: async (_q, _c, fallback) => answers.shift() ?? fallback };
    const deps: SetupDeps = {
      installSkill: (write) => { if (write) skillWrites++; return [{ agent: "agents", file: "/h/.agents/skills/ovis-browser/SKILL.md", action: "installed" }]; },
      chrome: () => "/Applications/Google Chrome.app",
      serve: () => ({ status: serve, available: tailscale }),
      runTailscale: (command) => { ran.push(command); return { ok: true, output: "" }; },
      origin: (port) => `https://pc.ts.net${port === 443 ? "" : `:${port}`}`,
    };
    const code = await setup(parseSetupArguments(["setup", ...args]), io, deps);
    return { code, lines: lines.join("\n"), ran, skillWrites };
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
});
