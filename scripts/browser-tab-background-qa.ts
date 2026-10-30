import assert from "node:assert/strict";
import type { Page } from "playwright-core";

/** Exercise hidden-tab recovery against the demo Chrome, without activating the hidden tab to inspect it. */
export async function checkBackgroundTab(page: Page, cdpUrl: string): Promise<void> {
  const targets = await (await fetch(`${cdpUrl}/json/list`)).json() as { id: string; type: string; url: string; webSocketDebuggerUrl?: string }[];
  const first = targets.find((target) => target.type === "page" && /^http:\/\/[^/]+\/$/.test(target.url));
  const second = targets.find((target) => target.type === "page" && target.url.endsWith("/second.html"));
  if (!first?.webSocketDebuggerUrl || !second) throw new Error("Demo tabs are unavailable");
  const version = await (await fetch(`${cdpUrl}/json/version`)).json() as { webSocketDebuggerUrl: string };
  const browser = new WebSocket(version.webSocketDebuggerUrl);
  const tab = new WebSocket(first.webSocketDebuggerUrl);
  const opened = (socket: WebSocket) => new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("CDP connection failed")), { once: true });
  });
  await Promise.all([opened(browser), opened(tab)]);
  let id = 0;
  const call = (socket: WebSocket, method: string, params: object) => new Promise<unknown>((resolve, reject) => {
    const command = ++id;
    const onMessage = (event: MessageEvent) => {
      const reply = JSON.parse(String(event.data)) as { id?: number; error?: unknown; result?: { result?: { value?: unknown } } };
      if (reply.id !== command) return;
      socket.removeEventListener("message", onMessage);
      if (reply.error) reject(new Error(`${method}: ${JSON.stringify(reply.error)}`));
      else resolve(reply.result?.result?.value);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ id: command, method, params }));
  });
  const visible = () => call(tab, "Runtime.evaluate", { expression: "document.visibilityState", returnByValue: true });
  const until = async (check: () => Promise<boolean>, label: string) => {
    const deadline = Date.now() + 8_000;
    while (!await check()) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
      await Bun.sleep(25);
    }
  };
  try {
    const release = page.getByRole("button", { name: "Release", exact: true });
    if (await release.isVisible()) await release.click();
    await call(browser, "Target.activateTarget", { targetId: second.id });
    const picker = page.getByRole("combobox", { name: "Browser tab" });
    const choose = async (name: RegExp) => {
      await picker.click();
      await page.getByRole("listbox", { name: "Browser tab" }).getByRole("option", { name }).click();
    };
    await choose(/Browser tab second page/);
    await until(async () => (await picker.locator(".browser-tab-title").innerText()).includes("Browser tab second page"), "second tab selection");
    await page.locator(".browser-frame img").waitFor();
    await until(async () => await visible() === "hidden", "demo tab to become hidden");
    const checkOverlay = async () => {
      await choose(/Browser tab interaction demo/);
      const card = page.locator(".browser-background-card");
      await card.waitFor();
      assert.equal(await picker.isEnabled(), true, "picker must remain enabled");
      assert.match(await picker.locator(".browser-tab-title").innerText(), /Browser tab interaction demo/);
      assert.equal(await visible(), "hidden", "viewing a tab must not activate Chrome");
      return card;
    };
    const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
    let card = await checkOverlay();
    const back = card.getByRole("button", { name: /Back to Browser tab second page/ });
    if (coarse) await back.tap(); else await back.click();
    await until(async () => (await picker.locator(".browser-tab-title").innerText()).includes("Browser tab second page"), "return to visible tab");
    await page.locator(".browser-frame img").waitFor();
    card = await checkOverlay();
    const show = card.getByRole("button", { name: "Show this tab" });
    if (coarse) await show.tap(); else await show.click();
    await until(async () => await visible() === "visible", "explicitly shown tab to become visible");
    await card.waitFor({ state: "hidden" });
    await page.locator(".browser-frame img").waitFor();
    assert.match(await picker.locator(".browser-tab-title").innerText(), /Browser tab interaction demo/);
  } finally { browser.close(); tab.close(); }
}
