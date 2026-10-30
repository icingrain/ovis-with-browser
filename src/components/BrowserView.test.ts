import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { SettingsProvider } from "../lib/settings.ts";
import { BrowserView } from "./BrowserView.tsx";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onerror: (() => void) | null = null;
  private listeners = new Map<string, (event: { data: string }) => void>();
  constructor(readonly url: string) { FakeEventSource.instances.push(this); }
  addEventListener(name: string, listener: (event: { data: string }) => void) { this.listeners.set(name, listener); }
  emit(name: string, data: object) { this.listeners.get(name)?.({ data: JSON.stringify(data) }); }
  close() {}
}

describe("BrowserView control handoff", () => {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  let renderer: ReactTestRenderer | undefined;
  let requests: { path: string; body: Record<string, unknown> }[];
  let foregroundTabId: string | undefined;
  let coarsePointer: boolean;
  let storedInputMode: string | null;
  beforeEach(() => {
    requests = [];
    foregroundTabId = undefined;
    coarsePointer = false;
    storedInputMode = null;
    FakeEventSource.instances = [];
    for (const key of ["window", "document", "navigator", "EventSource", "fetch", "getComputedStyle", "IS_REACT_ACT_ENVIRONMENT"])
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      localStorage: { getItem: () => storedInputMode, setItem: (_key: string, value: string) => { storedInputMode = value; } },
      matchMedia: () => ({ matches: coarsePointer, addEventListener() {}, removeEventListener() {} }),
      addEventListener() {}, removeEventListener() {},
    } });
    Object.defineProperty(globalThis, "document", { configurable: true, value: {
      documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} } }, querySelector: () => null,
    } });
    Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: () => ({ getPropertyValue: () => "" }) });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { languages: ["en-US"] } });
    Object.defineProperty(globalThis, "EventSource", { configurable: true, value: FakeEventSource });
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (url: string, init?: RequestInit) => {
      if (!init?.method) return Response.json({ session: { pane_id: "test-pane" }, foreground_tab_id: foregroundTabId, tabs: [
        { id: "one", title: "One", url: "about:blank" }, { id: "two", title: "Two", url: "about:blank" },
      ] });
      requests.push({ path: url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return Response.json({ ok: true });
    } });
  });
  afterEach(async () => {
    await act(async () => { renderer?.unmount(); });
    jest.useRealTimers();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
  });

  it("swallows the first click, forwards later input, and releases on a tab switch", async () => {
    await act(async () => { renderer = create(createElement(SettingsProvider, null, createElement(BrowserView, { paneId: "test-pane", onSessionGone() {} }))); });
    const stream = FakeEventSource.instances[0];
    expect(stream?.url).toContain("tab_id=one");
    await act(async () => {
      stream?.emit("ready", { stream_id: "stream-one" });
      stream?.emit("frame", { data: "ZmFrZQ==", width: 800, height: 600, offsetTop: 0, pageScaleFactor: 1 });
    });
    const pointer = { clientX: 100, clientY: 50, button: 0, buttons: 1, detail: 1,
      altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, preventDefault() {},
      currentTarget: { focus() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }) },
    };
    await act(async () => {
      renderer!.root.findByType("img").props.onMouseDown(pointer);
      renderer!.root.findByType("img").props.onMouseUp({ ...pointer, buttons: 0 });
    });
    expect(requests.map((request) => request.path.split("/").at(-1))).toEqual(["control"]);
    expect(requests[0]?.body).toMatchObject({ stream_id: "stream-one", enabled: true });
    await act(async () => {
      renderer!.root.findByType("img").props.onMouseDown(pointer);
      renderer!.root.findByType("img").props.onMouseUp({ ...pointer, buttons: 0 });
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    const input = requests.filter((request) => request.path.endsWith("/input")).map((request) => request.body.event as { type: string; x: number; y: number });
    expect(input.map((event) => event.type)).toEqual(["mouseMoved", "mousePressed", "mouseReleased"]);
    expect(input[1]).toMatchObject({ x: 200, y: 100 });
    expect(renderer!.root.findAllByType("select")).toHaveLength(0);
    const picker = renderer!.root.findByProps({ className: "browser-tab-picker" });
    const trigger = picker.findByProps({ role: "combobox" });
    expect(trigger.props).toMatchObject({ "aria-haspopup": "listbox", "aria-expanded": false, disabled: false });
    await act(async () => { picker.parent!.props.onChange("two"); });
    expect(FakeEventSource.instances.at(-1)?.url).toContain("tab_id=two");
    expect(renderer!.root.findAllByProps({ "aria-pressed": false }).length).toBeGreaterThan(0);
  });

  it("opens the visible tab despite list order and keeps a user choice on refresh", async () => {
    jest.useFakeTimers();
    foregroundTabId = "two";
    await act(async () => { renderer = create(createElement(SettingsProvider, null, createElement(BrowserView, { paneId: "test-pane", onSessionGone() {} }))); });
    const picker = renderer!.root.findByProps({ className: "browser-tab-picker" });
    const title = () => picker.findByProps({ className: "browser-tab-title" }).children.join("");
    expect(title()).toBe("Two");
    await act(async () => { picker.parent!.props.onChange("one"); });
    expect(title()).toBe("One");
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(title()).toBe("One");
  });

  it("defaults to Trackpad for a coarse pointer and remembers a Direct choice", async () => {
    coarsePointer = true;
    await act(async () => { renderer = create(createElement(SettingsProvider, null, createElement(BrowserView, { paneId: "test-pane", onSessionGone() {} }))); });
    const modes = renderer!.root.findByProps({ "aria-label": "Browser input mode" }).findAllByType("button");
    expect(modes.map((button) => button.props["aria-pressed"])).toEqual([false, true]);
    await act(async () => { modes[0]!.props.onClick(); });
    expect(modes.map((button) => button.props["aria-pressed"])).toEqual([true, false]);
    expect(storedInputMode).toBe("direct");
  });

  it("releases a locked mouse button before closing its stream on unmount", async () => {
    coarsePointer = true;
    await act(async () => { renderer = create(createElement(SettingsProvider, null, createElement(BrowserView, { paneId: "test-pane", onSessionGone() {} }))); });
    await act(async () => {
      FakeEventSource.instances[0]?.emit("ready", { stream_id: "stream-one" });
      FakeEventSource.instances[0]?.emit("frame", { data: "ZmFrZQ==", width: 800, height: 600 });
    });
    const toolbar = renderer!.root.findByProps({ className: "browser-toolbar" });
    await act(async () => { toolbar.findAllByType("button").find((button) => button.props.children === "Take control")!.props.onClick(); });
    const controls = renderer!.root.findByProps({ className: "browser-trackpad-controls" });
    await act(async () => { controls.findAllByType("button")[1]!.props.onClick(); });
    expect(requests.some((request) => (request.body.event as { type?: string } | undefined)?.type === "mousePressed")).toBe(true);
    await act(async () => { renderer!.unmount(); await new Promise<void>((resolve) => setImmediate(resolve)); });
    const release = requests.findIndex((request) => (request.body.event as { type?: string } | undefined)?.type === "mouseReleased");
    const controlOff = requests.findIndex((request) => request.path.endsWith("/control") && request.body.enabled === false);
    expect(release).toBeGreaterThan(-1);
    expect(controlOff).toBeGreaterThan(release);
  });

  it("does not enter control on wheel, swallows the first key, and releases on Escape", async () => {
    await act(async () => { renderer = create(createElement(SettingsProvider, null, createElement(BrowserView, { paneId: "test-pane", onSessionGone() {} }))); });
    await act(async () => {
      FakeEventSource.instances[0]?.emit("ready", { stream_id: "stream-one" });
      FakeEventSource.instances[0]?.emit("frame", { data: "ZmFrZQ==", width: 800, height: 600 });
    });
    const image = renderer!.root.findByType("img");
    image.props.onWheel({ deltaX: 0, deltaY: 100 });
    expect(requests).toEqual([]);
    const key = { key: "a", code: "KeyA", keyCode: 65, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, preventDefault() {} };
    await act(async () => { image.props.onKeyDown(key); image.props.onKeyUp(key); });
    expect(requests.map((request) => request.path.split("/").at(-1))).toEqual(["control"]);
    await act(async () => {
      image.props.onKeyDown(key);
      image.props.onKeyUp(key);
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    expect(requests.filter((request) => request.path.endsWith("/input")).map((request) => (request.body.event as { type: string }).type))
      .toEqual(["keyDown", "char", "keyUp"]);
    await act(async () => { image.props.onKeyDown({ ...key, key: "Escape", code: "Escape", keyCode: 27 }); });
    expect(requests.at(-1)?.body).toMatchObject({ stream_id: "stream-one", enabled: false });
  });

  it("returns to view-only after 60 seconds without input", async () => {
    jest.useFakeTimers();
    await act(async () => { renderer = create(createElement(SettingsProvider, null, createElement(BrowserView, { paneId: "test-pane", onSessionGone() {} }))); });
    await act(async () => {
      FakeEventSource.instances[0]?.emit("ready", { stream_id: "stream-one" });
      FakeEventSource.instances[0]?.emit("frame", { data: "ZmFrZQ==", width: 800, height: 600 });
    });
    const image = renderer!.root.findByType("img");
    await act(async () => { image.props.onKeyDown({ key: "a", code: "KeyA", preventDefault() {} }); });
    expect(renderer!.root.findAllByProps({ "aria-pressed": true }).length).toBeGreaterThan(0);
    await act(async () => { jest.advanceTimersByTime(59_999); });
    expect(renderer!.root.findAllByProps({ "aria-pressed": true }).length).toBeGreaterThan(0);
    await act(async () => { jest.advanceTimersByTime(1); });
    expect(renderer!.root.findAllByProps({ "aria-pressed": false }).length).toBeGreaterThan(0);
    expect(requests.at(-1)?.body).toMatchObject({ stream_id: "stream-one", enabled: false });
  });
});
