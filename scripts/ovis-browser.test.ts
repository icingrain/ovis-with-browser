import { describe, expect, it } from "bun:test";
import { chromeCandidates, findChrome, parseBrowserArguments, profileDirectory } from "./ovis-browser.ts";

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
