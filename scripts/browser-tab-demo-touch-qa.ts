import assert from "node:assert/strict";
import { chromium, type Browser, type CDPSession, type Page } from "playwright-core";
import { chromePath } from "./chrome-path.ts";
import { checkBackgroundTab } from "./browser-tab-background-qa.ts";

const origin = process.env["BROWSER_QA_UI"] ? new URL(process.env["BROWSER_QA_UI"]!).origin : undefined;
const paneId = process.env["BROWSER_QA_PANE"];
const cdpUrl = process.env["BROWSER_QA_CDP"];
if (!origin || !paneId || !cdpUrl) throw new Error("Set BROWSER_QA_UI, BROWSER_QA_PANE, and BROWSER_QA_CDP from the isolated demo run");
if (["localhost", "127.0.0.1", "0.0.0.0"].includes(new URL(origin).hostname)) throw new Error("BROWSER_QA_UI must use the Tailscale address");

type CdpReply = { id?: number; result?: { result?: { value?: unknown } }; error?: unknown };
type TouchPoint = { x: number; y: number; id: number };
let demoSocket: WebSocket | undefined;
let uiBrowser: Browser | undefined;
let currentStep = "startup";
const step = async (name: string, run: () => Promise<void>) => {
  currentStep = name;
  process.stdout.write(`START ${name}\n`);
  await run();
  process.stdout.write(`PASS  ${name}\n`);
};
const until = async (check: () => Promise<boolean>, label: string) => {
  const deadline = Date.now() + 5_000;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await Bun.sleep(25);
  }
};

try {
  const tabs = await (await fetch(`${cdpUrl}/json/list`)).json() as { type: string; url: string; webSocketDebuggerUrl?: string }[];
  const target = tabs.find((tab) => tab.type === "page" && /^http:\/\/[^/]+\/$/.test(tab.url));
  if (!target?.webSocketDebuggerUrl) throw new Error("Demo page is not open in Chrome");
  demoSocket = new WebSocket(target.webSocketDebuggerUrl);
  const socket = demoSocket;
  const pending = new Map<number, (reply: CdpReply) => void>();
  let commandId = 0;
  socket.addEventListener("message", (event) => {
    let reply: CdpReply;
    try { reply = JSON.parse(String(event.data)); } catch { return; }
    if (reply.id === undefined) return;
    pending.get(reply.id)?.(reply);
    pending.delete(reply.id);
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("Demo CDP connection failed")), { once: true });
  });
  const cdp = async (method: string, params?: object) => {
    const id = ++commandId;
    const reply = await new Promise<CdpReply>((resolve) => {
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, ...(params ? { params } : {}) }));
    });
    if (reply.error) throw new Error(`${method}: ${JSON.stringify(reply.error)}`);
    return reply;
  };
  const evaluate = async (expression: string) => (await cdp("Runtime.evaluate", { expression, returnByValue: true })).result?.result?.value;
  const read = async () => JSON.parse(String(await evaluate("JSON.stringify(window.demoState)"))) as Record<string, unknown>;
  await step("reset demo page", async () => {
    await cdp("Page.reload", { ignoreCache: true });
    await until(async () => Boolean(await evaluate("window.demoState")), "demo state");
    await cdp("Page.bringToFront");
    await until(async () => await evaluate("document.visibilityState") === "visible", "demo visibility");
  });
  await step("register pane", async () => {
    const base = `${origin}/api/pane/browser`;
    const current = await (await fetch(`${base}?pane_id=${encodeURIComponent(paneId)}`)).json() as { session: { cdpUrl: string } | null };
    if (current.session?.cdpUrl === cdpUrl) return;
    if (current.session) throw new Error(`Pane already points to ${current.session.cdpUrl}`);
    const response = await fetch(`${base}/register`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ pane_id: paneId, cdp_url: cdpUrl }) });
    assert.equal(response.status, 200, await response.text());
  });

  uiBrowser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox"] });
  const context = await uiBrowser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: "en-US" });
  const ui = await context.newPage();
  await ui.goto(`${origin}/?pane=${encodeURIComponent(paneId)}&view=browser`);
  const image = ui.locator(".browser-frame img");
  await image.waitFor();
  assert.equal(await ui.evaluate(() => matchMedia("(pointer: coarse)").matches), true, "touch context must emulate a coarse pointer");
  assert.equal(await ui.getByRole("button", { name: "Trackpad" }).getAttribute("aria-pressed"), "true");
  await step("header browser switch fits phone widths", async () => {
    for (const width of [390, 360]) {
      await ui.setViewportSize({ width, height: 844 });
      const button = ui.locator('.app-header .view-switch button[title="Browser"]');
      await button.waitFor({ state: "visible" });
      const bounds = await button.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, `Browser button clipped at ${width}px`);
      const geometry = await button.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        let clipped = false;
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          const bounds = parent.getBoundingClientRect();
          if (["hidden", "clip", "auto", "scroll"].includes(style.overflowX) && (rect.left < bounds.left || rect.right > bounds.right)) clipped = true;
          if (["hidden", "clip", "auto", "scroll"].includes(style.overflowY) && (rect.top < bounds.top || rect.bottom > bounds.bottom)) clipped = true;
        }
        return { clipped, hit: element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) };
      });
      assert.equal(geometry.clipped, false, `Browser button clipped by a container at ${width}px`);
      assert.equal(geometry.hit, true, `Browser button obstructed at ${width}px`);
    }
    await ui.setViewportSize({ width: 390, height: 844 });
  });
  const uiCdp: CDPSession = await context.newCDPSession(ui);
  const dispatch = (type: "touchStart" | "touchMove" | "touchEnd", touchPoints: TouchPoint[]) =>
    uiCdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  await step("tab picker uses a dismissible phone sheet", async () => {
    const picker = ui.getByRole("combobox", { name: "Browser tab" });
    const sheet = ui.getByRole("dialog", { name: "Browser tab" });
    const list = sheet.getByRole("listbox", { name: "Browser tab" });
    const show = async () => { await picker.click(); await list.waitFor(); };
    await show();
    await until(async () => {
      const bounds = await sheet.boundingBox();
      return !!bounds && Math.abs(bounds.y + bounds.height - 844) < 2;
    }, "sheet reaches bottom edge");
    assert.ok(await list.getByRole("option").count() >= 2, "sheet lists browser tabs");
    await list.focus();
    await ui.keyboard.press("ArrowDown");
    await ui.keyboard.press("Tab");
    assert.equal(await sheet.getByRole("button", { name: "Cancel" }).evaluate((button) => document.activeElement === button), true, "Tab reaches Cancel");
    await ui.keyboard.press("Shift+Tab");
    assert.equal(await list.evaluate((element) => document.activeElement === element), true, "Shift+Tab returns to the options");
    await ui.goBack();
    await sheet.waitFor({ state: "hidden" });
    assert.equal(await picker.evaluate((button) => document.activeElement === button), true, "Back restores picker focus");
    await show();
    await ui.mouse.click(8, 8);
    await sheet.waitFor({ state: "hidden" });
    assert.equal(await picker.evaluate((button) => document.activeElement === button), true, "outside tap restores picker focus");
    await show();
    const grip = await sheet.locator(".row-sheet-grip").boundingBox();
    if (!grip) throw new Error("Sheet grip is not visible");
    const at = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2, id: 1 };
    await dispatch("touchStart", [at]);
    await dispatch("touchMove", [{ ...at, y: at.y + 180 }]);
    await dispatch("touchEnd", []);
    await sheet.waitFor({ state: "hidden" });
    assert.equal(await picker.evaluate((button) => document.activeElement === button), true, "swipe restores picker focus");
  });
  const box = async () => {
    const bounds = await image.boundingBox();
    if (!bounds) throw new Error("Browser screenshot is not visible");
    return bounds;
  };
  const center = async () => {
    const bounds = await box();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  };
  const tap = async () => {
    const at = await center();
    await dispatch("touchStart", [{ ...at, id: 1 }]);
    await dispatch("touchEnd", []);
  };
  const gesture = async (dx: number, dy: number) => {
    const at = await center();
    await dispatch("touchStart", [{ ...at, id: 1 }]);
    await dispatch("touchMove", [{ x: at.x + dx, y: at.y + dy, id: 1 }]);
    await dispatch("touchEnd", []);
  };
  const cursor = async () => ui.locator(".browser-trackpad-cursor").evaluate((element) => {
    const image = document.querySelector<HTMLImageElement>(".browser-frame img");
    if (!image) throw new Error("No browser frame image");
    const bounds = image.getBoundingClientRect();
    const style = (element as HTMLElement).style;
    return { x: bounds.left + parseFloat(style.left) / 100 * bounds.width,
      y: bounds.top + parseFloat(style.top) / 100 * bounds.height };
  });
  const targetPoint = async (id: string, fraction = 0.5) => {
    const result = await evaluate(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, viewportWidth: innerWidth, viewportHeight: innerHeight }; })()`) as
      { x: number; y: number; width: number; height: number; viewportWidth: number; viewportHeight: number };
    const bounds = await box();
    return { x: bounds.x + (result.x + result.width * fraction) * bounds.width / result.viewportWidth,
      y: bounds.y + (result.y + result.height / 2) * bounds.height / result.viewportHeight };
  };
  const moveCursorTo = async (id: string, fraction = 0.5) => {
    const target = await targetPoint(id, fraction);
    for (let attempt = 0; attempt < 12; attempt++) {
      const current = await cursor();
      const dx = target.x - current.x, dy = target.y - current.y;
      if (Math.hypot(dx, dy) < 7) return;
      const scale = Math.min(1, 70 / Math.max(Math.abs(dx), Math.abs(dy)));
      await gesture(dx * scale, dy * scale);
    }
    const pageBounds = await evaluate(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, viewportWidth: innerWidth, viewportHeight: innerHeight }; })()`);
    throw new Error(`Cursor did not reach ${id}: ${JSON.stringify({ target, cursor: await cursor(), image: await box(), page: pageBounds })}`);
  };

  await step("first tap enters control", async () => {
    await moveCursorTo("slider", 0.25);
    await tap();
    await ui.locator(".browser-frame.is-controlling").waitFor();
    assert.equal((await read())["slider"], 25, "first tap reached the page");
  });
  await step("tap then drag slider", async () => {
    const before = Number((await read())["slider"]);
    await gesture(75, 0);
    await until(async () => Number((await read())["slider"]) > before, "slider drag");
  });
  await step("one-finger tap clicks", async () => {
    await moveCursorTo("click");
    await tap();
    await until(async () => Number((await read())["clicks"]) === 1, "tap click");
  });
  await step("one-finger movement hovers", async () => {
    await moveCursorTo("hover");
    await until(async () => Number((await read())["hover"]) > 0, "hover");
  });
  await step("right-click button and two-finger tap", async () => {
    await moveCursorTo("right");
    await ui.getByRole("button", { name: "Right click" }).click();
    await until(async () => Number((await read())["rightClicks"]) === 1, "right-click button");
    const at = await center();
    await dispatch("touchStart", [{ x: at.x - 12, y: at.y, id: 1 }]);
    await dispatch("touchStart", [{ x: at.x - 12, y: at.y, id: 1 }, { x: at.x + 12, y: at.y, id: 2 }]);
    await dispatch("touchEnd", [{ x: at.x + 12, y: at.y, id: 2 }]);
    await dispatch("touchEnd", []);
    await until(async () => Number((await read())["rightClicks"]) === 2, "two-finger right click");
  });
  await step("drag lock holds and releases", async () => {
    await moveCursorTo("drag-box");
    const before = Number((await read())["dragMoves"]);
    const lock = ui.getByRole("button", { name: "Drag lock" });
    await lock.click();
    assert.equal(await lock.getAttribute("aria-pressed"), "true");
    await gesture(55, 12);
    await until(async () => Number((await read())["dragMoves"]) > before, "locked drag");
    await lock.click();
    assert.equal(await lock.getAttribute("aria-pressed"), "false");
    await until(async () => ((await read())["events"] as string[]).includes("drag end"), "drag release");
  });
  await step("two-finger movement scrolls", async () => {
    await moveCursorTo("scroll-area");
    const before = Number((await read())["wheel"]);
    const at = await center();
    await dispatch("touchStart", [{ x: at.x - 12, y: at.y, id: 1 }]);
    await dispatch("touchStart", [{ x: at.x - 12, y: at.y, id: 1 }, { x: at.x + 12, y: at.y, id: 2 }]);
    await dispatch("touchMove", [{ x: at.x - 12, y: at.y - 45, id: 1 }, { x: at.x + 12, y: at.y - 45, id: 2 }]);
    await dispatch("touchEnd", []);
    await until(async () => Number((await read())["wheel"]) > before, "two-finger wheel");
  });
  await step("keyboard button forwards typed text", async () => {
    await moveCursorTo("text");
    await tap();
    await ui.getByRole("button", { name: "Keyboard", exact: true }).click();
    await ui.keyboard.type("q");
    await until(async () => String((await read())["text"]).includes("q"), "keyboard text");
  });
  await step("switch browser tabs in the phone sheet", async () => {
    const picker = ui.getByRole("combobox", { name: "Browser tab" });
    await picker.click();
    const list = ui.getByRole("listbox", { name: "Browser tab" });
    await list.getByRole("option", { name: /Browser tab second page/ }).click();
    await until(async () => (await picker.locator(".browser-tab-title").innerText()).includes("Browser tab second page"), "second browser tab");
    await ui.getByRole("button", { name: "Release", exact: true }).waitFor();
    await until(async () => await evaluate("document.visibilityState") === "hidden", "interaction tab hidden after controlled switch");
    await picker.click();
    await list.getByRole("option", { name: /Browser tab interaction demo/ }).click();
    await until(async () => (await picker.locator(".browser-tab-title").innerText()).includes("Browser tab interaction demo"), "interaction browser tab");
    await until(async () => await evaluate("document.visibilityState") === "visible", "interaction tab visible after controlled switch");
  });
  await step("background tab recovery", () => checkBackgroundTab(ui, cdpUrl));
  process.stdout.write("Browser touchpad gestures passed against Chrome's DOM event log.\n");
} catch (error) {
  process.stderr.write(`FAIL ${currentStep}: ${String(error)}\n`);
  throw error;
} finally {
  await uiBrowser?.close();
  demoSocket?.close();
}
