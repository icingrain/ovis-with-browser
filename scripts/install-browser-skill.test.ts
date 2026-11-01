import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENTS, SKILL_BANNER, helperCommand, installBrowserSkill, parseSkillArguments, renderSkill, skillTargets } from "./install-browser-skill.ts";

const withHome = (run: (home: string) => void) => {
  const home = mkdtempSync(join(tmpdir(), "ovis-skill-"));
  try { run(home); } finally { rmSync(home, { recursive: true, force: true }); }
};

describe("browser skill installer", () => {
  it("names each agent's skill folder under the directory the agent reads", () => {
    const targets = skillTargets("/h", { CODEX_HOME: "/c", XDG_CONFIG_HOME: "/x" });
    expect(targets.map((target) => target.file)).toEqual(["/h/.claude/skills/ovis-browser/SKILL.md", "/c/skills/ovis-browser/SKILL.md", "/x/opencode/skills/ovis-browser/SKILL.md", "/h/.agents/skills/ovis-browser/SKILL.md"]);
  });

  it("fills in the helper and puts the banner under the front matter", () => {
    const text = renderSkill("---\nname: a\n---\n\nRun {{HELPER}} start\n", "bun x");
    expect(text).toBe(`---\nname: a\n---\n${SKILL_BANNER}\n\nRun bun x start\n`);
    expect(() => renderSkill("no front matter", "x")).toThrow("front matter");
    expect(helperCommand("/r", "win32")).toBe('bun "/r/scripts/ovis-browser.ts"');
    expect(helperCommand("/r", "linux")).toBe('sh "/r/scripts/with-bun.sh" "/r/scripts/ovis-browser.ts"');
  });

  it("writes nothing without --yes, and only into agents whose folder exists", () => withHome((home) => {
    mkdirSync(join(home, ".claude"));
    const preview = installBrowserSkill({ home, env: {} });
    expect(preview.map((result) => [result.agent, result.action])).toEqual([["claude", "would-install"]]);
    expect(existsSync(join(home, ".claude", "skills"))).toBe(false);
    const done = installBrowserSkill({ home, env: {}, write: true });
    expect(done[0]!.action).toBe("installed");
    const file = join(home, ".claude", "skills", "ovis-browser", "SKILL.md");
    expect(readFileSync(file, "utf8")).toContain(SKILL_BANNER);
    expect(readFileSync(file, "utf8")).not.toContain("{{HELPER}}");
    expect(installBrowserSkill({ home, env: {}, write: true })[0]!.action).toBe("updated");
  }));

  it("installs where --agent says even when the agent's folder is not there yet", () => withHome((home) => {
    const results = installBrowserSkill({ home, env: {}, agents: ["codex"], write: true });
    expect(results.map((result) => [result.agent, result.action])).toEqual([["codex", "installed"]]);
  }));

  it("leaves a skill of that name that it did not write, and removes only its own", () => withHome((home) => {
    const file = join(home, ".claude", "skills", "ovis-browser", "SKILL.md");
    mkdirSync(join(home, ".claude", "skills", "ovis-browser"), { recursive: true });
    writeFileSync(file, "mine");
    expect(installBrowserSkill({ home, env: {}, write: true })[0]!.action).toBe("kept");
    expect(installBrowserSkill({ home, env: {}, write: true, remove: true })[0]!.action).toBe("kept");
    expect(readFileSync(file, "utf8")).toBe("mine");
    rmSync(file);
    installBrowserSkill({ home, env: {}, write: true });
    expect(installBrowserSkill({ home, env: {}, remove: true })[0]!.action).toBe("would-remove");
    expect(installBrowserSkill({ home, env: {}, write: true, remove: true })[0]!.action).toBe("removed");
    expect(existsSync(file)).toBe(false);
    expect(installBrowserSkill({ home, env: {}, write: true, remove: true })[0]!.action).toBe("absent");
  }));

  it("parses its arguments", () => {
    expect(parseSkillArguments(["--yes", "--agent", "codex", "--agent", "claude"])).toEqual({ agents: ["codex", "claude"], write: true });
    expect(() => parseSkillArguments(["--agent", "nope"])).toThrow(AGENTS.join(", "));
    expect(() => parseSkillArguments(["--wat"])).toThrow("Unknown argument");
  });
});
