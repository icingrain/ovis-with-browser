import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromeCandidates, findChrome, parseBrowserArguments, profileDirectory, start } from "./ovis-browser.ts";

describe("ovis-browser helper", () => {
  it("takes the pane from the environment and the server from OVIS_URL", () => {
    expect(parseBrowserArguments(["start"], { HERDR_PANE_ID: "w1:p2", OVIS_URL: "http://127.0.0.1:9000/", OVIS_TOKEN: "t" })).toEqual({
      command: "start", pane: "w1:p2", ovis: "http://127.0.0.1:9000", token: "t", url: "about:blank", chrome: null,
    });
    expect(parseBrowserArguments([], { HERDR_PANE_ID: "p" }).command).toBe("start");
  });

  it("lets flags override the environment and refuses what it does not know", () => {
    const options = parseBrowserArguments(["start", "--pane", "x", "--url", "https://a.test", "--ovis", "http://h:1", "--chrome", "/c"], { HERDR_PANE_ID: "p", CHROME_PATH: "/env" });
    expect([options.pane, options.url, options.ovis, options.chrome]).toEqual(["x", "https://a.test", "http://h:1", "/c"]);
    expect(() => parseBrowserArguments(["start"], {})).toThrow("HERDR_PANE_ID");
    expect(() => parseBrowserArguments(["go"], { HERDR_PANE_ID: "p" })).toThrow("Unknown command");
    expect(() => parseBrowserArguments(["start", "--url"], { HERDR_PANE_ID: "p" })).toThrow("needs a value");
    expect(() => parseBrowserArguments(["start", "--wat"], { HERDR_PANE_ID: "p" })).toThrow("Unknown argument");
  });

  it("finds a Chrome: the named one, else the first candidate that exists", () => {
    expect(findChrome({ chrome: "/named" }, "linux", {}, (path) => path === "/named")).toBe("/named");
    expect(() => findChrome({ chrome: "/missing" }, "linux", {}, () => false)).toThrow("not found");
    expect(findChrome({ chrome: null }, "darwin", {}, (path) => path.includes("Chromium"))).toContain("Chromium");
    expect(() => findChrome({ chrome: null }, "linux", {}, () => false)).toThrow("CHROME_PATH");
    expect(chromeCandidates("win32", { PROGRAMFILES: "C:\\P" })[0]).toContain("chrome.exe");
  });

  it("keeps one profile per pane apart from any person's", () => {
    expect(profileDirectory("w1:p2", "/home/u")).toBe("/home/u/.ovis-browser/w1_p2");
  });
});

describe("ovis-browser start after Ovis restart", () => {
  it("re-registers the pane's still-running Chrome from state.json instead of relaunching it", async () => {
    const ovisCalls: { method: string; path: string; body: string }[] = [];
    const ovis = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        const body = await req.text();
        ovisCalls.push({ method: req.method, path: url.pathname, body });
        if (req.method === "POST" && url.pathname === "/api/pane/browser/register") {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(JSON.stringify({ session: null }), { status: 200 });
      },
    });
    // Fake Chrome DevTools port answering /json/version, standing in for the still-running Chrome.
    const cdp = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      fetch: () => new Response(JSON.stringify({ Browser: "stub" }), { status: 200 }),
    });
    const home = mkdtempSync(join(tmpdir(), "ovis-browser-test-"));
    const pane = "paneA";
    const profileDir = join(home, ".ovis-browser", pane);
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "state.json"), JSON.stringify({ pid: 1, port: cdp.port }));
    try {
      const cdpUrl = await start({ command: "start", pane, ovis: `http://127.0.0.1:${ovis.port}`, token: null, url: "about:blank", chrome: null, home });

      // Reuse the saved port rather than launching a new Chrome.
      expect(cdpUrl).toBe(`http://127.0.0.1:${cdp.port}`);
      const register = ovisCalls.find((call) => call.method === "POST" && call.path === "/api/pane/browser/register");
      expect(register).toBeDefined();
      expect(JSON.parse(register!.body)).toEqual({ pane_id: pane, cdp_url: `http://127.0.0.1:${cdp.port}` });
      // Only the launch path rewrites state.json; reuse leaves it intact.
      expect(JSON.parse(readFileSync(join(profileDir, "state.json"), "utf8")).port).toBe(cdp.port);
    } finally {
      ovis.stop(true);
      cdp.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  });
});
