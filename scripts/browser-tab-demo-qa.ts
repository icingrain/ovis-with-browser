import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright-core";
import { chromePath } from "./chrome-path.ts";
import { checkBackgroundTab } from "./browser-tab-background-qa.ts";

const origin = process.env["BROWSER_QA_UI"] ? new URL(process.env["BROWSER_QA_UI"]!).origin : undefined;
const paneId = process.env["BROWSER_QA_PANE"];
const cdpUrl = process.env["BROWSER_QA_CDP"];
if (!origin || !paneId || !cdpUrl) throw new Error("Set BROWSER_QA_UI, BROWSER_QA_PANE, and BROWSER_QA_CDP from the isolated demo run");
if (["localhost", "127.0.0.1", "0.0.0.0"].includes(new URL(origin).hostname)) throw new Error("BROWSER_QA_UI must use the isolated web UI server's Tailscale address");

let uiBrowser: Browser | undefined;
let demoSocket: WebSocket | undefined;
const registration = `${origin}/api/pane/browser?pane_id=${encodeURIComponent(paneId)}`;
let currentStep = "startup";
const step = async (name: string, run: () => Promise<void>) => {
  currentStep = name;
  process.stdout.write(`START ${name}\n`);
  await run();
  process.stdout.write(`PASS  ${name}\n`);
};

try {
  const targets = await (await fetch(`${cdpUrl}/json/list`)).json() as { type: string; url: string; webSocketDebuggerUrl?: string }[];
  const target = targets.find((entry) => entry.type === "page" && /^http:\/\/[^/]+\/$/.test(entry.url));
  if (!target?.webSocketDebuggerUrl) throw new Error("Demo page is not open in Chrome");
  demoSocket = new WebSocket(target.webSocketDebuggerUrl);
  const socket = demoSocket;
  const pending = new Map<number, { resolve: (value: { result?: { result?: { value?: unknown } }; error?: unknown }) => void; reject: (reason: Error) => void }>();
  let commandId = 0;
  socket.addEventListener("message", (event) => {
    let reply: { id?: number; result?: { result?: { value?: unknown } }; error?: unknown };
    try { reply = JSON.parse(String(event.data)); } catch { return; }
    if (reply.id === undefined) return;
    const waiter = pending.get(reply.id);
    if (!waiter) return;
    pending.delete(reply.id);
    waiter.resolve(reply);
  });
  socket.addEventListener("close", () => {
    for (const waiter of pending.values()) waiter.reject(new Error("Demo CDP connection closed"));
    pending.clear();
  });
  if (socket.readyState !== WebSocket.OPEN) await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("Demo CDP connection failed")), { once: true });
  });
  const cdp = async (method: string, params?: object) => {
    const id = ++commandId;
    const reply = await new Promise<{ result?: { result?: { value?: unknown } }; error?: unknown }>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, ...(params ? { params } : {}) }));
    });
    if (reply.error) throw new Error(`${method}: ${JSON.stringify(reply.error)}`);
    return reply;
  };
  const evaluate = async (expression: string): Promise<unknown> => (await cdp("Runtime.evaluate", { expression, returnByValue: true })).result?.result?.value;
  const until = async (check: () => Promise<boolean>, label: string) => {
    const deadline = Date.now() + 5_000;
    while (!await check()) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
      await Bun.sleep(25);
    }
  };
  await step("reset demo page", async () => {
    await cdp("Page.reload", { ignoreCache: true });
    await until(async () => Boolean(await evaluate("window.demoState")), "demo state");
    await cdp("Page.bringToFront");
    await until(async () => await evaluate("document.visibilityState") === "visible", "interaction tab visibility");
    await evaluate("window.qaRaw=[]; for (const name of ['mousemove','mousedown','mouseup','click','contextmenu']) document.addEventListener(name,e=>window.qaRaw.push(name+':'+e.button+':'+e.target.id),true)");
  });
  const read = async () => {
    return JSON.parse(String(await evaluate("JSON.stringify(window.demoState)"))) as Record<string, unknown>;
  };
  const waitFor = async (field: string, value: unknown) => {
    await until(async () => (await read())[field] === value, `${field}=${String(value)}`);
    assert.equal((await read())[field], value);
  };
  await step("register pane", async () => {
    const previous = await fetch(registration);
    const body = await previous.json() as { session: { cdpUrl: string } | null };
    if (body.session?.cdpUrl === cdpUrl) return;
    if (body.session) throw new Error(`Pane already points to ${body.session.cdpUrl}`);
    const response = await fetch(`${origin}/api/pane/browser/register`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pane_id: paneId, cdp_url: cdpUrl }),
    });
    assert.equal(response.status, 200, await response.text());
  });
  uiBrowser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox"] });
  const ui = await uiBrowser.newPage({ locale: "en-US", viewport: { width: 1440, height: 900 } });
  const inputPosts: unknown[] = [];
  const inputResponses: unknown[] = [];
  const pageErrors: string[] = [];
  ui.on("pageerror", (error) => pageErrors.push(error.message));
  ui.on("request", (request) => {
    if (request.url().includes("/api/pane/browser/")) inputPosts.push({ path: request.url(), body: JSON.parse(request.postData() ?? "{}") });
  });
  ui.on("response", (response) => {
    if (response.url().includes("/api/pane/browser/")) inputResponses.push({ path: response.url(), status: response.status() });
  });
  await ui.goto(`${origin}/?pane=${encodeURIComponent(paneId)}&view=browser`);
  const image = ui.locator(".browser-frame img");
  await image.waitFor();
  const picker = ui.getByRole("combobox", { name: "Browser tab" });
  const selectedTab = await picker.locator(".browser-tab-title").innerText();
  assert.match(selectedTab, /Browser tab interaction demo/, `Browser view selected ${selectedTab} instead of the interaction page`);
  await ui.evaluate(() => {
    (window as unknown as { qaMouse: string[] }).qaMouse = [];
    for (const name of ["mousedown", "mouseup", "contextmenu"]) document.addEventListener(name, (event) => {
      const mouse = event as MouseEvent;
      (window as unknown as { qaMouse: string[] }).qaMouse.push(`capture:${name}:${mouse.button}:${(event.target as Element).tagName}`);
    }, true);
    for (const name of ["mousedown", "mouseup", "contextmenu"]) document.addEventListener(name, (event) => {
      const mouse = event as MouseEvent;
      (window as unknown as { qaMouse: string[] }).qaMouse.push(`bubble:${name}:${mouse.button}:prevented=${event.defaultPrevented}`);
    });
  });
  const rect = async (id: string) => {
    const expression = `(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, viewportWidth: innerWidth, viewportHeight: innerHeight }; })()`;
    const target = await evaluate(expression) as { x: number; y: number; width: number; height: number; viewportWidth: number; viewportHeight: number };
    const box = await image.boundingBox();
    if (!box) throw new Error("Browser frame is not visible");
    return { x: box.x + target.x * box.width / target.viewportWidth, y: box.y + target.y * box.height / target.viewportHeight,
      width: target.width * box.width / target.viewportWidth, height: target.height * box.height / target.viewportHeight };
  };
  const point = async (id: string) => {
    const box = await rect(id);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const click = async (id: string, options?: Parameters<Page["mouse"]["click"]>[2]) => {
    const pos = await point(id);
    await ui.mouse.click(pos.x, pos.y, options);
  };
  await step("first click enters control without page click", async () => {
    await click("click");
    await ui.locator(".browser-frame.is-controlling").waitFor();
    assert.equal((await read())["clicks"], 0, "the click that enters control reached the page");
  });
  await step("click", async () => {
    const pos = await point("click");
    const before = inputPosts.length;
    await ui.mouse.click(pos.x, pos.y);
    try { await waitFor("clicks", 1); }
    catch (error) {
      const hit = await ui.evaluate(({ x, y }) => ({ hit: document.elementFromPoint(x, y)?.tagName, mouse: (window as unknown as { qaMouse: string[] }).qaMouse }), pos);
      const raw = await evaluate("window.qaRaw");
      process.stderr.write(`Click trace: ${JSON.stringify({ pos, hit, input: inputPosts.slice(before), responses: inputResponses.slice(-10), state: await read(), raw, selectedTab: await picker.locator(".browser-tab-title").innerText(), controlled: await ui.locator(".browser-frame.is-controlling").count(), pageErrors })}\n`);
      throw error;
    }
  });
  await step("double click", async () => { await click("double", { clickCount: 2 }); await waitFor("doubleClicks", 1); });
  await step("right click", async () => {
    const pos = await point("right");
    const before = inputPosts.length;
    await ui.mouse.click(pos.x, pos.y, { button: "right" });
    try { await waitFor("rightClicks", 1); }
    catch (error) {
      const hit = await ui.evaluate(({ x, y }) => ({ hit: document.elementFromPoint(x, y)?.outerHTML.slice(0, 160), mouse: (window as unknown as { qaMouse: string[] }).qaMouse }), pos);
      process.stderr.write(`Right-click trace: ${JSON.stringify({ pos, hit, input: inputPosts.slice(before), controlled: await ui.locator(".browser-frame.is-controlling").count(), pageErrors })}\n`);
      throw error;
    }
  });
  await step("hover", async () => {
    const before = Number((await read())["hover"]);
    const hover = await point("hover");
    await ui.mouse.move(hover.x, hover.y);
    await until(async () => Number((await read())["hover"]) > before, "hover event");
    assert.ok(Number((await read())["hover"]) > before);
    assert.equal(await evaluate("document.getElementById('hover').classList.contains('active')"), true, "hover highlight is not visible");
  });
  await step("drag", async () => {
    const before = await read();
    const start = await rect("drag-box");
    const drag = await point("drag-box");
    await ui.mouse.move(drag.x, drag.y);
    await ui.mouse.down();
    await ui.mouse.move(drag.x + 80, drag.y + 20, { steps: 5 });
    await ui.mouse.up();
    await until(async () => {
      const state = await read();
      return Number(state["dragMoves"]) > Number(before["dragMoves"]) && (state["events"] as string[]).slice((before["events"] as string[]).length).includes("drag end");
    }, "drag move and release");
    const after = await read();
    assert.ok(Number(after["dragMoves"]) > Number(before["dragMoves"]));
    assert.ok((after["events"] as string[]).slice((before["events"] as string[]).length).includes("drag end"), "drag did not release on the page");
    const end = await rect("drag-box");
    assert.ok(end.x > start.x + 20, "the draggable box did not move");
  });
  await step("range slider drag", async () => {
    const slider = await rect("slider");
    const y = slider.y + slider.height / 2;
    await ui.mouse.move(slider.x + slider.width * 0.25, y);
    await ui.mouse.down();
    await ui.mouse.move(slider.x + slider.width * 0.8, y, { steps: 6 });
    await ui.mouse.up();
    await until(async () => Number((await read())["slider"]) >= 60, "slider value");
    assert.ok(Number((await read())["slider"]) >= 60);
  });
  await step("text input", async () => {
    const before = inputPosts.length;
    await click("text"); await ui.keyboard.type("ab");
    try { await waitFor("text", "ab"); }
    catch (error) {
      process.stderr.write(`Text trace: ${JSON.stringify({ input: inputPosts.slice(before), responses: inputResponses.slice(-10), state: await read(), active: await evaluate("document.activeElement?.id"), uiActive: await ui.evaluate(() => document.activeElement?.tagName), pageErrors })}\n`);
      throw error;
    }
  });
  await step("Backspace", async () => { await ui.keyboard.press("Backspace"); await waitFor("text", "a"); });
  await step("select option", async () => {
    await click("select");
    const menu = ui.getByRole("listbox", { name: "Choose option" });
    await menu.waitFor();
    await menu.focus();
    await ui.keyboard.press("ArrowDown");
    await ui.keyboard.press("Enter");
    await menu.waitFor({ state: "hidden" });
    await waitFor("selected", "beta");
  });
  await step("alert", async () => {
    await click("alert");
    const dialog = ui.getByRole("alertdialog", { name: "Browser dialog" });
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "OK" }).click();
    await dialog.waitFor({ state: "hidden" });
    await waitFor("alertResult", "acknowledged");
  });
  await step("confirm", async () => {
    await click("confirm");
    const dialog = ui.getByRole("alertdialog", { name: "Browser dialog" });
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await dialog.waitFor({ state: "hidden" });
    await waitFor("confirmResult", false);
  });
  await step("prompt", async () => {
    await click("prompt");
    const dialog = ui.getByRole("alertdialog", { name: "Browser dialog" });
    await dialog.waitFor();
    await dialog.getByRole("textbox", { name: "Response" }).fill("from web UI");
    await dialog.getByRole("button", { name: "OK" }).click();
    await dialog.waitFor({ state: "hidden" });
    await waitFor("promptResult", "from web UI");
  });
  await image.focus();
  for (const key of ["Enter", "ArrowLeft", "Tab", "Shift+A", "Control+A"]) await step(`key ${key}`, async () => {
    const before = ((await read())["keys"] as string[]).length;
    await ui.keyboard.press(key);
    const expected = key === "Shift+A" ? "shift=true" : key === "Control+A" ? "ctrl=true" : key;
    await until(async () => ((await read())["keys"] as string[]).slice(before).some((entry) => entry.includes(expected)), `key ${key}`);
    const keys = (await read())["keys"] as string[];
    assert.ok(keys.slice(before).some((entry) => entry.includes(expected)));
  });
  await step("switch browser tabs and back", async () => {
    await picker.focus();
    await ui.keyboard.press("ArrowDown");
    const list = ui.getByRole("listbox", { name: "Browser tab" });
    await list.waitFor();
    await ui.keyboard.press("Escape");
    await list.waitFor({ state: "hidden" });
    assert.equal(await picker.evaluate((button) => document.activeElement === button), true, "Escape did not restore tab picker focus");
    for (const key of ["Enter", "Space"]) {
      await ui.keyboard.press(key);
      await list.waitFor();
      await ui.keyboard.press("Escape");
      await list.waitFor({ state: "hidden" });
    }
    await picker.click();
    await list.focus();
    await ui.keyboard.press("Tab");
    await list.waitFor({ state: "hidden" });
    await picker.click();
    await ui.locator(".browser-tab-label").click();
    await list.waitFor({ state: "hidden" });
    await picker.click();
    await list.getByRole("option", { name: /Browser tab second page/ }).click();
    await until(async () => (await picker.locator(".browser-tab-title").innerText()).includes("Browser tab second page"), "second browser tab");
    await ui.getByRole("button", { name: "Release", exact: true }).waitFor();
    await until(async () => await evaluate("document.visibilityState") === "hidden", "interaction tab hidden after controlled switch");
    await picker.click();
    await list.focus();
    const labels = await list.getByRole("option").allTextContents();
    const targetIndex = labels.findIndex((label) => label.includes("Browser tab interaction demo"));
    assert.ok(targetIndex >= 0, "interaction tab is missing from the picker");
    await ui.keyboard.press("Home");
    for (let index = 0; index < targetIndex; index++) await ui.keyboard.press("ArrowDown");
    await ui.keyboard.press("Enter");
    await until(async () => (await picker.locator(".browser-tab-title").innerText()).includes("Browser tab interaction demo"), "interaction browser tab");
    await until(async () => await evaluate("document.visibilityState") === "visible", "interaction tab visible after controlled switch");
  });
  await step("background tab recovery", () => checkBackgroundTab(ui, cdpUrl));
  process.stdout.write("Browser tab demo interactions passed against Chrome's DOM event log.\n");
} catch (error) {
  process.stderr.write(`FAIL ${currentStep}: ${String(error)}\n`);
  throw error;
} finally {
  await uiBrowser?.close();
  demoSocket?.close();
}
