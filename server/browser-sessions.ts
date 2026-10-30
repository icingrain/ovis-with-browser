import { randomUUID } from "node:crypto";
import type { BrowserSession, BrowserTab } from "../shared/protocol.ts";
import { badRequest, jsonResponse, readJsonObject } from "./http.ts";

type CdpTab = BrowserTab & { type: string; webSocketDebuggerUrl?: string };
type CdpReply = { result?: { result?: { objectId?: string; value?: unknown } }; error?: unknown };
type BrowserOption = { value: string; label: string; disabled: boolean; selected: boolean; group: string | null };
type Dialog = { type: "alert" | "confirm" | "prompt" };
type Stream = { paneId: string; socket: WebSocket; controlled: boolean; inactive: boolean; frontRequested: boolean; close: () => void; send: (method: string, params?: object) => void; call: (method: string, params?: object) => Promise<CdpReply>; emit: (event: string, data: unknown) => void; selectObject?: string; selectOptions?: BrowserOption[]; pressPending?: Promise<boolean>; dialog?: Dialog };
const validInt = (value: unknown, max: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;

/** Only Chrome's local debugging listener may be registered or reached through a tab URL. */
function localCdpUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && !!url.port &&
      !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash ? url : null;
  } catch { return null; }
}

export class BrowserSessions {
  private readonly sessions = new Map<string, BrowserSession>();
  private readonly streams = new Map<string, Stream>();

  private closePane(paneId: string): void {
    for (const [id, stream] of this.streams) if (stream.paneId === paneId) {
      stream.close();
      this.streams.delete(id);
    }
  }

  stop(): void {
    for (const stream of this.streams.values()) stream.close();
    this.streams.clear();
    this.sessions.clear();
  }

  private async tabs(session: BrowserSession): Promise<CdpTab[]> {
    const response = await fetch(`${session.cdpUrl}/json/list`, { redirect: "manual", signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error("CDP tab list unavailable");
    const body: unknown = await response.json();
    if (!Array.isArray(body)) throw new Error("Invalid CDP tab list");
    return body.filter((entry): entry is CdpTab => entry !== null && typeof entry === "object" &&
      entry.type === "page" && typeof entry.id === "string" && typeof entry.title === "string" && typeof entry.url === "string");
  }

  /** Chrome does not order /json/list by the foreground tab. Probe without activating a target. */
  private async visibleTab(tabs: CdpTab[], session: BrowserSession): Promise<string | null> {
    const visible = await Promise.all(tabs.map(async (tab) => {
      const debuggerUrl = tab.webSocketDebuggerUrl;
      if (!debuggerUrl) return false;
      let url: URL;
      try { url = new URL(debuggerUrl); } catch { return false; }
      if (url.protocol !== "ws:" || url.hostname !== "127.0.0.1" || url.port !== new URL(session.cdpUrl).port || url.username || url.password) return false;
      return new Promise<boolean>((resolve) => {
        const socket = new WebSocket(url.href);
        let settled = false;
        const finish = (value: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          socket.close();
          resolve(value);
        };
        const timeout = setTimeout(() => finish(false), 1000);
        socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "document.visibilityState", returnByValue: true } })));
        socket.addEventListener("message", (event) => {
          let reply: CdpReply & { id?: number };
          try { reply = JSON.parse(String(event.data)); } catch { return; }
          if (reply.id === 1) finish(reply.result?.result?.value === "visible");
        });
        socket.addEventListener("error", () => finish(false));
        socket.addEventListener("close", () => finish(false));
      });
    }));
    return tabs.find((_, index) => visible[index])?.id ?? null;
  }

  async handle(request: Request, url: URL, pathname: string): Promise<Response | null> {
    if (pathname === "/api/pane/browser/register") {
      if (request.method !== "POST") return badRequest("method_not_allowed", "use POST");
      const body = await readJsonObject<{ pane_id?: unknown; cdp_url?: unknown }>(request);
      if (body instanceof Response) return body;
      if (typeof body.pane_id !== "string" || !body.pane_id) return badRequest("missing_pane_id", "pane_id is required");
      const cdp = localCdpUrl(body.cdp_url);
      if (!cdp) return badRequest("invalid_cdp_url", "cdp_url must be http://127.0.0.1:<port>");
      this.closePane(body.pane_id);
      const session: BrowserSession = { pane_id: body.pane_id, cdpUrl: cdp.origin, registeredAt: Date.now() };
      this.sessions.set(body.pane_id, session);
      return jsonResponse({ session });
    }
    if (pathname === "/api/pane/browser") {
      const paneId = url.searchParams.get("pane_id");
      if (!paneId) return badRequest("missing_pane_id", "pane_id query parameter is required");
      if (request.method === "DELETE") {
        this.closePane(paneId);
        this.sessions.delete(paneId);
        return jsonResponse({ ok: true });
      }
      if (request.method !== "GET") return badRequest("method_not_allowed", "use GET or DELETE");
      const session = this.sessions.get(paneId) ?? null;
      if (!session) return jsonResponse({ session: null, tabs: [] });
      try {
        const cdpTabs = await this.tabs(session);
        const foreground_tab_id = url.searchParams.get("foreground") === "1" ? await this.visibleTab(cdpTabs, session) : null;
        const tabs = cdpTabs.map(({ id, title, url: tabUrl }): BrowserTab => ({ id, title, url: tabUrl }));
        return jsonResponse({ session, tabs, foreground_tab_id });
      } catch {
        return jsonResponse({ session, tabs: [], unavailable: true });
      }
    }
    if (pathname === "/api/pane/browser/stream") {
      if (request.method !== "GET") return badRequest("method_not_allowed", "use GET");
      const paneId = url.searchParams.get("pane_id");
      const tabId = url.searchParams.get("tab_id");
      const session = paneId ? this.sessions.get(paneId) : null;
      if (!session || !tabId) return badRequest("missing_browser_tab", "registered pane and tab_id are required");
      let tab: CdpTab | undefined;
      try { tab = (await this.tabs(session)).find((entry) => entry.id === tabId); }
      catch { return jsonResponse({ error: { code: "cdp_unavailable", message: "Browser is unavailable" } }, 502); }
      if (!tab?.webSocketDebuggerUrl) return badRequest("invalid_browser_tab", "tab is not available for screencast");
      let debuggerUrl: URL;
      try { debuggerUrl = new URL(tab.webSocketDebuggerUrl); }
      catch { return badRequest("invalid_browser_tab", "invalid debugger URL"); }
      if (debuggerUrl.protocol !== "ws:" || debuggerUrl.hostname !== "127.0.0.1" ||
        debuggerUrl.port !== new URL(session.cdpUrl).port || debuggerUrl.username || debuggerUrl.password)
        return badRequest("invalid_browser_tab", "debugger URL must use the registered loopback endpoint");
      const id = randomUUID();
      const socket = new WebSocket(debuggerUrl.href);
      let commandId = 0;
      const pending = new Map<number, { resolve: (reply: CdpReply) => void; reject: (reason: Error) => void }>();
      const send = (method: string, params?: object): void => {
        socket.send(JSON.stringify({ id: ++commandId, method, ...(params ? { params } : {}) }));
      };
      const call = (method: string, params?: object): Promise<CdpReply> => new Promise((resolve, reject) => {
        const command = ++commandId;
        pending.set(command, { resolve, reject });
        socket.send(JSON.stringify({ id: command, method, ...(params ? { params } : {}) }));
      });
      let closed = false;
      let frameSeen = false;
      let frameTimer: ReturnType<typeof setTimeout> | undefined;
      let controller: ReadableStreamDefaultController<Uint8Array>;
      let waiting = false;
      let latestFrame: Uint8Array | undefined;
      const qualityParam = Number(url.searchParams.get("quality"));
      const widthParam = Number(url.searchParams.get("max_width"));
      const heightParam = Number(url.searchParams.get("max_height"));
      const quality = Number.isInteger(qualityParam) && qualityParam >= 1 && qualityParam <= 70 ? qualityParam : 70;
      const dimensions = widthParam >= 320 && widthParam <= 1920 && heightParam >= 240 && heightParam <= 1920 &&
        Number.isInteger(widthParam) && Number.isInteger(heightParam) ? { maxWidth: widthParam, maxHeight: heightParam } : {};
      const emit = (event: string, data: unknown) => {
        waiting = false;
        controller.enqueue(encode(event, data));
      };
      const encode = (event: string, data: unknown) => new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      const close = (): void => {
        if (closed) return;
        closed = true;
        if (frameTimer) clearTimeout(frameTimer);
        this.streams.delete(id);
        for (const waiter of pending.values()) waiter.reject(new Error("CDP stream closed"));
        pending.clear();
        socket.close();
        try { controller.close(); } catch { /* client already left */ }
      };
      const stream = new ReadableStream<Uint8Array>({
        start: (sink) => {
          controller = sink;
          socket.addEventListener("open", () => {
            waiting = false;
            sink.enqueue(encode("ready", { stream_id: id }));
            send("Page.enable");
          });
          socket.addEventListener("message", (event) => {
            if (closed) return;
            let frame: CdpReply & { id?: number; method?: string; params?: { data?: string; sessionId?: number; visible?: boolean; type?: string; message?: string; defaultPrompt?: string; metadata?: { deviceWidth?: number; deviceHeight?: number; offsetTop?: number; pageScaleFactor?: number } } };
            try { frame = JSON.parse(String(event.data)); } catch { return; }
            if (frame.id !== undefined && pending.has(frame.id)) {
              const waiter = pending.get(frame.id)!;
              pending.delete(frame.id);
              waiter.resolve(frame);
              return;
            }
            if (frame.method === "Page.javascriptDialogOpening") {
              const current = this.streams.get(id);
              const kind = frame.params?.type;
              if (current && !current.dialog && (kind === "alert" || kind === "confirm" || kind === "prompt")) {
                current.dialog = { type: kind };
                current.emit("dialog", { type: kind, message: frame.params?.message ?? "", defaultPrompt: frame.params?.defaultPrompt ?? "" });
              }
              return;
            }
            if (frame.method === "Page.javascriptDialogClosed") {
              const current = this.streams.get(id);
              if (current?.dialog) { current.dialog = undefined; current.emit("dialog-close", {}); }
              return;
            }
            if (frame.method === "Page.frameNavigated") {
              const current = this.streams.get(id);
              if (current) { current.selectObject = undefined; current.selectOptions = undefined; current.emit("select-close", {}); }
            }
            if (frame.id === 1) {
              // Page.enable is enough to start a passive screencast, even with a dialog open.
              send("Page.startScreencast", { format: "jpeg", quality, everyNthFrame: 1, ...dimensions });
              frameTimer = setTimeout(() => {
                if (closed || frameSeen) return;
                const current = this.streams.get(id);
                if (current) {
                  current.inactive = true;
                  if (current.controlled && !current.frontRequested && current.socket.readyState === WebSocket.OPEN) {
                    current.frontRequested = true;
                    current.send("Page.bringToFront");
                  }
                }
                emit("inactive", {});
              }, 2000);
              return;
            }
            if (frame.method === "Page.screencastVisibilityChanged" && frame.params?.visible === false) {
              const current = this.streams.get(id);
              if (current) {
                current.inactive = true;
                if (current.controlled && !current.frontRequested && current.socket.readyState === WebSocket.OPEN) {
                  current.frontRequested = true;
                  current.send("Page.bringToFront");
                }
              }
              emit("inactive", {});
              return;
            }
            if (frame.method !== "Page.screencastFrame" || typeof frame.params?.data !== "string") return;
            frameSeen = true;
            if (frameTimer) clearTimeout(frameTimer);
            const current = this.streams.get(id);
            if (current) { current.inactive = false; current.frontRequested = false; }
            latestFrame = encode("frame", { data: frame.params.data, width: frame.params.metadata?.deviceWidth, height: frame.params.metadata?.deviceHeight, offsetTop: frame.params.metadata?.offsetTop, pageScaleFactor: frame.params.metadata?.pageScaleFactor });
            if (waiting) { waiting = false; sink.enqueue(latestFrame); latestFrame = undefined; }
            if (typeof frame.params.sessionId === "number") send("Page.screencastFrameAck", { sessionId: frame.params.sessionId });
          });
          socket.addEventListener("close", close);
          socket.addEventListener("error", close);
        },
        pull: (sink) => {
          if (latestFrame) { sink.enqueue(latestFrame); latestFrame = undefined; }
          else waiting = true;
        },
        cancel: close,
      }, { highWaterMark: 0 });
      this.streams.set(id, { paneId: session.pane_id, socket, controlled: false, inactive: false, frontRequested: false, close, send, call, emit });
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" } });
    }
    if (["/api/pane/browser/control", "/api/pane/browser/input", "/api/pane/browser/select", "/api/pane/browser/dialog"].includes(pathname)) {
      if (request.method !== "POST") return badRequest("method_not_allowed", "use POST");
      const body = await readJsonObject<{ stream_id?: unknown; enabled?: unknown; show_tab?: unknown; event?: unknown; events?: unknown; index?: unknown; accept?: unknown; promptText?: unknown }>(request);
      if (body instanceof Response) return body;
      const stream = typeof body.stream_id === "string" ? this.streams.get(body.stream_id) : undefined;
      if (!stream) return badRequest("invalid_stream", "browser stream is closed");
      if (pathname.endsWith("/control")) {
        if (typeof body.enabled !== "boolean" || (body.show_tab !== undefined && typeof body.show_tab !== "boolean")) return badRequest("invalid_control", "enabled and show_tab must be boolean");
        if (body.enabled && stream.socket.readyState !== WebSocket.OPEN) return badRequest("invalid_stream", "browser stream is not connected");
        stream.controlled = body.enabled;
        if (stream.socket.readyState === WebSocket.OPEN) stream.send("Emulation.setFocusEmulationEnabled", { enabled: body.enabled });
        if (!body.enabled) { stream.selectObject = undefined; stream.selectOptions = undefined; }
        if (stream.controlled && (stream.inactive || body.show_tab === true) && !stream.frontRequested && stream.socket.readyState === WebSocket.OPEN) {
          stream.frontRequested = true;
          stream.send("Page.bringToFront");
        }
        return jsonResponse({ controlled: stream.controlled });
      }
      if (!stream.controlled) return jsonResponse({ error: { code: "view_only", message: "Take control before sending input" } }, 403);
      if (stream.socket.readyState !== WebSocket.OPEN) return badRequest("invalid_stream", "browser stream is not connected");
      if (pathname.endsWith("/select")) {
        if (!validInt(body.index, 10000) || !stream.selectObject || !stream.selectOptions?.[body.index] || stream.selectOptions?.[body.index]?.disabled)
          return badRequest("invalid_option", "option index is unavailable");
        const objectId = stream.selectObject;
        const result = await stream.call("Runtime.callFunctionOn", { objectId, functionDeclaration: "function(index) { const option = this.options[index]; if (!this.isConnected || !option || option.disabled || option.parentElement?.disabled) return false; this.selectedIndex = index; this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true })); return true; }", arguments: [{ value: body.index }], returnByValue: true });
        if (result.error || result.result?.result?.value !== true) return badRequest("invalid_option", "option is unavailable");
        stream.selectObject = undefined;
        stream.selectOptions = undefined;
        stream.emit("select-close", {});
        return jsonResponse({ ok: true });
      }
      if (pathname.endsWith("/dialog")) {
        if (typeof body.accept !== "boolean" || !stream.dialog || (body.promptText !== undefined && (typeof body.promptText !== "string" || body.promptText.length > 4096)))
          return badRequest("invalid_dialog", "dialog answer is invalid");
        const dialog = stream.dialog;
        const answer = await stream.call("Page.handleJavaScriptDialog", { accept: body.accept, ...(dialog.type === "prompt" && body.accept ? { promptText: body.promptText ?? "" } : {}) });
        if (answer.error) return badRequest("invalid_dialog", "dialog is unavailable");
        // Older CDP endpoints may omit javascriptDialogClosed. The object identity keeps a
        // subsequent dialog, opened before this command's reply, from being closed here.
        if (stream.dialog === dialog) { stream.dialog = undefined; stream.emit("dialog-close", {}); }
        return jsonResponse({ ok: true });
      }
      if (body.events !== undefined) {
        if (body.event !== undefined || !Array.isArray(body.events) || body.events.length < 1 || body.events.length > 64)
          return badRequest("invalid_input", "events must be an array of 1 to 64 inputs");
        for (const event of body.events) {
          const single = new Request(request.url, { method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ stream_id: body.stream_id, event }) });
          const response = await this.handle(single, url, pathname);
          if (!response || !response.ok) return response ?? badRequest("invalid_input", "unsupported browser input");
        }
        return jsonResponse({ ok: true });
      }
      const event = body.event;
      if (event === null || typeof event !== "object" || Array.isArray(event)) return badRequest("invalid_input", "event must be an object");
      const input = event as Record<string, unknown>;
      const mouse = input.type === "mouseMoved" || input.type === "mousePressed" || input.type === "mouseReleased" || input.type === "mouseWheel";
      const key = input.type === "keyDown" || input.type === "keyUp" || input.type === "char";
      const modifiers = input.modifiers === undefined ? 0 : input.modifiers;
      if (mouse && typeof input.x === "number" && Number.isFinite(input.x) && typeof input.y === "number" && Number.isFinite(input.y) &&
        (input.button === "left" || input.button === "middle" || input.button === "right" || input.button === "none") &&
        validInt(modifiers, 15) && (input.buttons === undefined || validInt(input.buttons, 31)) &&
        (input.clickCount === undefined || validInt(input.clickCount, 3)) &&
        (input.type !== "mouseWheel" || typeof input.deltaX === "number" && Number.isFinite(input.deltaX) && typeof input.deltaY === "number" && Number.isFinite(input.deltaY))) {
        if (input.type === "mousePressed" && input.button === "left") {
          if (stream.selectObject) {
            stream.selectObject = undefined;
            stream.selectOptions = undefined;
            stream.emit("select-close", {});
          }
          const x = input.x, y = input.y;
          stream.pressPending = (async () => {
            // Native pickers for multiple selects, date, color and file inputs are outside this prototype.
            const hit = await stream.call("Runtime.evaluate", { expression: `(() => { const select = document.elementFromPoint(${JSON.stringify(x)}, ${JSON.stringify(y)})?.closest('select'); return select && !select.disabled && !select.multiple ? select : undefined; })()`, returnByValue: false });
            const objectId = hit.result?.result?.objectId;
            if (!objectId) return false;
            const options = await stream.call("Runtime.callFunctionOn", { objectId, functionDeclaration: "function() { return Array.from(this.options, option => ({ value: option.value, label: option.label, disabled: option.disabled || !!option.parentElement?.disabled, selected: option.selected, group: option.parentElement instanceof HTMLOptGroupElement ? option.parentElement.label : null })); }", returnByValue: true });
            const value = options.result?.result?.value;
            if (!Array.isArray(value)) return false;
            stream.selectObject = objectId;
            stream.selectOptions = value as BrowserOption[];
            stream.emit("select", { options: value });
            return true;
          })();
          let selected = false;
          try { selected = await stream.pressPending; } catch { /* a detached page falls through to normal input */ }
          if (selected) return jsonResponse({ ok: true });
        }
        if (input.type === "mouseReleased" && input.button === "left" && stream.pressPending) {
          let selected = false;
          try { selected = await stream.pressPending; } catch { /* a detached page falls through to normal input */ }
          stream.pressPending = undefined;
          if (selected) return jsonResponse({ ok: true });
        }
        stream.send("Input.dispatchMouseEvent", {
          type: input.type, x: input.x, y: input.y, button: input.button, modifiers,
          ...(input.buttons === undefined ? {} : { buttons: input.buttons }),
          ...(input.type === "mouseWheel" ? { deltaX: input.deltaX, deltaY: input.deltaY } : { clickCount: input.clickCount ?? (input.type === "mouseMoved" ? 0 : 1) }),
        });
      } else if (key && typeof input.key === "string" && input.key.length < 32 &&
        typeof input.code === "string" && input.code.length < 32 &&
        validInt(input.windowsVirtualKeyCode, 255) && validInt(modifiers, 15) &&
        (input.text === undefined || typeof input.text === "string" && input.text.length < 32)) {
        stream.send("Input.dispatchKeyEvent", { type: input.type, key: input.key, code: input.code, windowsVirtualKeyCode: input.windowsVirtualKeyCode, modifiers, ...(typeof input.text === "string" ? { text: input.text } : {}) });
      } else return badRequest("invalid_input", "unsupported browser input");
      return jsonResponse({ ok: true });
    }
    return null;
  }
}
