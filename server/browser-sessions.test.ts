import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "./index.ts";

describe("browser registration", () => {
  let server: ReturnType<typeof createServer>;
  let stateDir: string;
  const register = (cdp_url: string) => fetch(`http://127.0.0.1:${server.port}/api/pane/browser/register`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pane_id: "test-pane", cdp_url }),
  });
  beforeAll(() => {
    stateDir = mkdtempSync(join(tmpdir(), "herdr-browser-route-"));
    server = createServer({ port: 0, hostname: "127.0.0.1", stateDir, token: "", machines: false, sidecar: false });
  });
  afterAll(() => { server.stop(); rmSync(stateDir, { recursive: true, force: true }); });

  for (const url of ["http://localhost:9222", "http://127.0.0.2:9222", "https://127.0.0.1:9222", "http://example.com:9222", "http://127.0.0.1:9222@evil.test", "http://127.0.0.1:9222/path"]) {
    it(`rejects a non-loopback CDP endpoint: ${url}`, async () => {
      const response = await register(url);
      expect(response.status).toBe(400);
      expect((await response.json() as { error: { code: string } }).error.code).toBe("invalid_cdp_url");
    });
  }

  it("registers a local CDP endpoint for the pane", async () => {
    const response = await register("http://127.0.0.1:9222");
    expect(response.status).toBe(200);
    const body = await response.json() as { session: { pane_id: string; cdpUrl: string; registeredAt: number } };
    expect(body.session.pane_id).toBe("test-pane");
    expect(body.session.cdpUrl).toBe("http://127.0.0.1:9222");
    expect(body.session.registeredAt).toBeNumber();
  });

  it("streams a CDP frame and gates input until Take control", async () => {
    const commands: string[] = [];
    const received: { method: string; params?: Record<string, unknown> }[] = [];
    let receivedSix: (() => void) | undefined;
    const firstSix = new Promise<void>((resolve) => { receivedSix = resolve; });
    let receivedFifteen: (() => void) | undefined;
    const firstFifteen = new Promise<void>((resolve) => { receivedFifteen = resolve; });
    const page = { pressed: false, clicked: false, inputValue: "", selected: "alpha", inputEvents: 0, changeEvents: 0, dialogAccepted: false, promptText: "" };
    const cdp = Bun.serve<{ tabId: string }>({
      port: 0, hostname: "127.0.0.1",
      fetch(request, socketServer) {
        if (new URL(request.url).pathname === "/json/list") return Response.json([
          { id: "tab-2", type: "page", title: "Background", url: "https://example.test/background", webSocketDebuggerUrl: `ws://127.0.0.1:${socketServer.port}/devtools/page/tab-2` },
          { id: "tab-1", type: "page", title: "Foreground", url: "https://example.test/", webSocketDebuggerUrl: `ws://127.0.0.1:${socketServer.port}/devtools/page/tab-1` },
        ]);
        if (socketServer.upgrade(request, { data: { tabId: new URL(request.url).pathname.split("/").at(-1) ?? "" } })) return undefined;
        return new Response(null, { status: 404 });
      },
      websocket: {
        message(socket, raw) {
          const message = JSON.parse(String(raw)) as { id: number; method: string; params?: Record<string, unknown> };
          commands.push(message.method);
          if (message.method === "Emulation.setFocusEmulationEnabled") socket.send(JSON.stringify({ id: 2, result: {} }));
          if (message.method === "Page.startScreencast") {
            socket.send(JSON.stringify({ method: "Page.screencastFrame", params: { data: "ZmFrZS1qcGVn", sessionId: 1, metadata: { deviceWidth: 800, deviceHeight: 600, offsetTop: 0, pageScaleFactor: 1 } } }));
            socket.send(JSON.stringify({ method: "Page.screencastVisibilityChanged", params: { visible: false } }));
          }
          if (message.method === "Runtime.evaluate") {
            const expression = String(message.params?.expression);
            const result = expression === "document.visibilityState"
              ? { value: socket.data.tabId === "tab-1" ? "visible" : "hidden" }
              : expression.includes("111") ? { objectId: "select-1" } : { type: "undefined" };
            socket.send(JSON.stringify({ id: message.id, result: { result } }));
          }
          if (message.method === "Runtime.callFunctionOn") {
            if (String(message.params?.functionDeclaration).includes("Array.from")) socket.send(JSON.stringify({ id: message.id, result: { result: { value: [
              { value: "alpha", label: "Alpha", disabled: false, selected: true, group: null },
              { value: "beta", label: "Beta", disabled: false, selected: false, group: "Group" },
              { value: "gamma", label: "Gamma", disabled: true, selected: false, group: null },
            ] } } }));
            else {
              const index = (message.params?.arguments as { value: number }[])[0]?.value;
              page.selected = index === 1 ? "beta" : "alpha";
              const declaration = String(message.params?.functionDeclaration);
              if (declaration.includes("dispatchEvent(new Event('input'")) page.inputEvents++;
              if (declaration.includes("dispatchEvent(new Event('change'")) page.changeEvents++;
              socket.send(JSON.stringify({ id: message.id, result: { result: { value: true } } }));
            }
          }
          if (message.method === "Page.handleJavaScriptDialog") {
            page.dialogAccepted = message.params?.accept === true;
            page.promptText = String(message.params?.promptText ?? "");
            socket.send(JSON.stringify({ method: "Page.javascriptDialogClosed", params: { result: page.dialogAccepted } }));
            socket.send(JSON.stringify({ id: message.id, result: {} }));
            socket.send(JSON.stringify({ method: "Page.screencastFrame", params: { data: "cG9zdC1kaWFsb2c=", sessionId: 2 } }));
          }
          if (message.method.startsWith("Input.dispatch")) {
            received.push(message);
            if (received.length === 6) receivedSix?.();
            if (received.length === 15) receivedFifteen?.();
            if (message.params?.type === "mousePressed") page.pressed = true;
            if (message.params?.type === "mouseReleased" && page.pressed) { page.clicked = true; page.pressed = false; }
            if (message.params?.type === "char" && page.clicked) page.inputValue += message.params.text;
            if (message.params?.type === "mouseReleased" && message.params.x === 150) {
              const opened = JSON.stringify({ method: "Page.javascriptDialogOpening", params: { type: "prompt", message: "Demo prompt?", defaultPrompt: "default" } });
              socket.send(opened);
              socket.send(opened);
            }
          }
        },
      },
    });
    const base = `http://127.0.0.1:${server.port}/api/pane/browser`;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      expect((await register(`http://127.0.0.1:${cdp.port}`)).status).toBe(200);
      const list = await (await fetch(`${base}?pane_id=test-pane&foreground=1`)).json() as { tabs: { id: string }[]; foreground_tab_id: string };
      expect(list.tabs.map((tab) => tab.id)).toEqual(["tab-2", "tab-1"]);
      expect(list.foreground_tab_id).toBe("tab-1");
      const probes = commands.filter((method) => method === "Runtime.evaluate").length;
      expect((await fetch(`${base}?pane_id=test-pane`)).status).toBe(200);
      expect(commands.filter((method) => method === "Runtime.evaluate")).toHaveLength(probes);
      const response = await fetch(`${base}/stream?pane_id=test-pane&tab_id=tab-2`);
      expect(response.status).toBe(200);
      reader = response.body!.getReader();
      let events = "";
      while (!events.includes("event: frame")) events += new TextDecoder().decode((await reader.read()).value);
      const readThrough = async (marker: string) => { while (!events.includes(marker)) events += new TextDecoder().decode((await reader!.read()).value); };
      const streamId = /event: ready\ndata: (\{[^\n]+\})/.exec(events)?.[1];
      expect(streamId).toBeDefined();
      const id = (JSON.parse(streamId!) as { stream_id: string }).stream_id;
      expect(events).toContain("ZmFrZS1qcGVn");
      expect(commands).not.toContain("Page.bringToFront");
      expect(commands).not.toContain("Target.activateTarget");
      expect(commands.filter((command) => command !== "Runtime.evaluate").slice(0, 3)).toEqual(["Page.enable", "Emulation.setFocusEmulationEnabled", "Page.startScreencast"]);
      const event = { type: "mousePressed", x: 10, y: 20, button: "left" };
      const post = (path: string, body: object) => fetch(`${base}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      expect((await post("input", { stream_id: id, event })).status).toBe(403);
      expect((await post("control", { stream_id: id, enabled: true })).status).toBe(200);
      expect(commands).toContain("Page.bringToFront");
      expect((await post("input", { stream_id: id, event: { type: "mouseMoved", x: 10, y: 20, button: "none" } })).status).toBe(200);
      expect((await post("input", { stream_id: id, event })).status).toBe(200);
      expect((await post("input", { stream_id: id, event: { type: "mouseReleased", x: 10, y: 20, button: "left" } })).status).toBe(200);
      const key = { key: "a", code: "KeyA", windowsVirtualKeyCode: 65 };
      expect((await post("input", { stream_id: id, event: { type: "keyDown", ...key } })).status).toBe(200);
      expect((await post("input", { stream_id: id, event: { type: "char", ...key, text: "a" } })).status).toBe(200);
      expect((await post("input", { stream_id: id, event: { type: "keyUp", ...key } })).status).toBe(200);
      await firstSix;
      expect(received.map((message) => message.params?.type)).toEqual(["mouseMoved", "mousePressed", "mouseReleased", "keyDown", "char", "keyUp"]);
      expect(received.find((message) => message.params?.type === "char")?.params).toMatchObject({ code: "KeyA", windowsVirtualKeyCode: 65, text: "a" });
      expect(page).toMatchObject({ pressed: false, clicked: true, inputValue: "a" });
      expect((await post("input", { stream_id: id, event: { type: "mousePressed", x: 20, y: 30, button: "right", buttons: 2, clickCount: 1 } })).status).toBe(200);
      expect((await post("input", { stream_id: id, event: { type: "mouseReleased", x: 20, y: 30, button: "right", buttons: 0, clickCount: 1 } })).status).toBe(200);
      expect((await post("input", { stream_id: id, event: { type: "mousePressed", x: 20, y: 30, button: "middle", buttons: 4, clickCount: 1 } })).status).toBe(200);
      expect((await post("input", { stream_id: id, event: { type: "mouseReleased", x: 20, y: 30, button: "middle", buttons: 0, clickCount: 1 } })).status).toBe(200);
      expect((await post("input", { stream_id: id, event: { type: "mousePressed", x: 40, y: 50, button: "left", buttons: 1, clickCount: 2 } })).status).toBe(200);
      expect((await post("input", { stream_id: id, event: { type: "mouseMoved", x: 60, y: 70, button: "left", buttons: 1 } })).status).toBe(200);
      expect((await post("input", { stream_id: id, event: { type: "mouseReleased", x: 60, y: 70, button: "left", buttons: 0, clickCount: 2 } })).status).toBe(200);
      expect((await post("input", { stream_id: id, event: { type: "mouseWheel", x: 60, y: 70, button: "none", buttons: 0, deltaX: 0, deltaY: 120 } })).status).toBe(200);
      expect((await post("input", { stream_id: id, event: { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 10 } })).status).toBe(200);
      await firstFifteen;
      expect(received).toContainEqual(expect.objectContaining({ method: "Input.dispatchMouseEvent", params: expect.objectContaining({ button: "right", buttons: 2 }) }));
      expect(received).toContainEqual(expect.objectContaining({ method: "Input.dispatchMouseEvent", params: expect.objectContaining({ clickCount: 2 }) }));
      expect(received).toContainEqual(expect.objectContaining({ method: "Input.dispatchMouseEvent", params: expect.objectContaining({ type: "mouseMoved", buttons: 1 }) }));
      expect(received).toContainEqual(expect.objectContaining({ method: "Input.dispatchKeyEvent", params: expect.objectContaining({ key: "Enter", modifiers: 10 }) }));
      expect((await post("input", { stream_id: id, event: { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 16 } })).status).toBe(400);
      expect((await post("control", { stream_id: id, enabled: false })).status).toBe(200);
      expect((await post("input", { stream_id: id, event })).status).toBe(403);
      expect((await post("select", { stream_id: id, index: 1 })).status).toBe(403);
      expect((await post("dialog", { stream_id: id, accept: true })).status).toBe(403);
      expect((await post("control", { stream_id: id, enabled: true })).status).toBe(200);
      expect((await post("input", { stream_id: id, event: { type: "mousePressed", x: 111, y: 20, button: "left" } })).status).toBe(200);
      await readThrough("event: select\n");
      expect(events).toContain('"group":"Group"');
      expect((await post("input", { stream_id: id, event: { type: "mouseReleased", x: 111, y: 20, button: "left" } })).status).toBe(200);
      expect(received.some((message) => message.params?.x === 111 && message.params?.type === "mousePressed")).toBe(false);
      expect((await post("select", { stream_id: "wrong", index: 1 })).status).toBe(400);
      expect((await post("select", { stream_id: id, index: 3 })).status).toBe(400);
      expect((await post("select", { stream_id: id, index: 2 })).status).toBe(400);
      expect((await post("select", { stream_id: id, index: 1 })).status).toBe(200);
      expect(page).toMatchObject({ selected: "beta", inputEvents: 1, changeEvents: 1 });
      expect((await post("input", { stream_id: id, event: { type: "mouseReleased", x: 150, y: 20, button: "left" } })).status).toBe(200);
      await readThrough("event: dialog\n");
      expect((await post("dialog", { stream_id: "wrong", accept: true })).status).toBe(400);
      const beforeAnswer = events.length;
      expect((await post("dialog", { stream_id: id, accept: true, promptText: "answer" })).status).toBe(200);
      await readThrough("cG9zdC1kaWFsb2c=");
      expect(events.slice(beforeAnswer).match(/event: dialog-close\n/g)).toHaveLength(1);
      expect(events.slice(beforeAnswer)).not.toContain("event: dialog\n");
      expect(page).toMatchObject({ dialogAccepted: true, promptText: "answer" });
    } finally {
      await reader?.cancel();
      cdp.stop(true);
    }
  });
});
