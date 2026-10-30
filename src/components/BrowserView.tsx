import { useContext, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Keyboard, LockKeyhole, MousePointer2, MousePointerClick, X } from "lucide-react";
import type { BrowserTab } from "../../shared/protocol.ts";
import { browserInputPoint, browserModifiers, browserMouseButton, browserVirtualKeyCode, browserWheelDelta, type BrowserMouseButton, type ScreencastSize } from "../lib/browserInput.ts";
import { BrowserInputQueue, type BrowserInput as Input } from "../lib/browserInputQueue.ts";
import { browserTouchpadStep, createTouchpadState, type TouchpadAction, type TouchpadEvent, type TouchpadState } from "../lib/browserTouchpad.ts";
import { useT } from "../lib/i18n.ts";
import { useMediaQuery } from "../lib/useMediaQuery.ts";
import { SHEET_QUERY, useSheetSwipe } from "../lib/sheets.ts";
import { useSheetHistory } from "../lib/sheetHistory.ts";
import { PanePresentedContext, PaneShownContext } from "../lib/paneSubmitContext.ts";
import "./RowMenu.css";
import "./BrowserView.css";

interface Props { paneId: string; presentationKey?: string; onSessionGone: (paneId: string) => void }
type Frame = ScreencastSize & { src: string };
type SelectOption = { value: string; label: string; disabled: boolean; selected: boolean; group: string | null };
type SelectPopup = { options: SelectOption[]; x: number; y: number };
type BrowserDialog = { type: "alert" | "confirm" | "prompt"; message: string; defaultPrompt: string };
type BrowserInputMode = "direct" | "trackpad";
const INPUT_MODE_KEY = "ovis:browser-input-mode";

function savedInputMode(): BrowserInputMode {
  try {
    const value = window.localStorage.getItem(INPUT_MODE_KEY);
    if (value === "direct" || value === "trackpad") return value;
  } catch { /* private browsing may block storage */ }
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches ? "trackpad" : "direct";
}

function BrowserTabPicker({ tabs, tabId, disabled, onChange }: { tabs: BrowserTab[]; tabId: string; disabled: boolean; onChange: (id: string) => void }) {
  const t = useT();
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  // a touch device gets the sheet at any width: a phone in landscape or on a desktop-site page is wider than SHEET_QUERY
  const sheet = useMediaQuery(`${SHEET_QUERY}, (pointer: coarse)`);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const [place, setPlace] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const selected = tabs.find((tab) => tab.id === tabId);

  const show = () => {
    if (disabled) return;
    activeRef.current = Math.max(0, tabs.findIndex((tab) => tab.id === tabId));
    setActive(activeRef.current);
    setOpen(true);
  };
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  };
  useSheetSwipe(surface, open && sheet ? () => close(true) : null);
  useSheetHistory(open && sheet, () => close(true));
  useLayoutEffect(() => {
    if (!open || !sheet) return;
    return () => { if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }); };
  }, [open, sheet]);
  const choose = (index: number) => {
    const tab = tabs[index];
    if (!tab) return;
    close(true);
    onChange(tab.id);
  };
  const move = (index: number) => {
    activeRef.current = Math.max(0, Math.min(tabs.length - 1, index));
    setActive(activeRef.current);
    menu.current?.querySelector<HTMLElement>(`[data-tab-index="${activeRef.current}"]`)?.scrollIntoView({ block: "nearest" });
  };

  useLayoutEffect(() => {
    if (!open) return;
    const button = trigger.current;
    const surface = menu.current;
    if (!button || !surface) return;
    if (sheet) { surface.focus({ preventScroll: true }); return; }
    const rect = button.getBoundingClientRect();
    const edge = 8;
    const gap = 4;
    const width = Math.min(Math.max(rect.width, 240), window.innerWidth - edge * 2);
    const left = Math.max(edge, Math.min(rect.left, window.innerWidth - width - edge));
    const below = rect.bottom + gap;
    const roomBelow = window.innerHeight - below - edge;
    const roomAbove = rect.top - gap - edge;
    const up = surface.offsetHeight > roomBelow && roomAbove > roomBelow;
    setPlace({ top: up ? Math.max(edge, rect.top - gap - Math.min(surface.offsetHeight, roomAbove)) : below,
      left, width, maxHeight: Math.max(edge, up ? roomAbove : roomBelow) });
    surface.focus({ preventScroll: true });
  }, [open, tabs, sheet]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!(sheet ? surface.current : menu.current)?.contains(target) && !trigger.current?.contains(target)) {
        if (sheet) event.preventDefault();
        close(sheet);
      }
    };
    const resize = () => close();
    document.addEventListener("pointerdown", outside, true);
    if (!sheet) window.addEventListener("resize", resize);
    return () => { document.removeEventListener("pointerdown", outside, true); window.removeEventListener("resize", resize); };
  }, [open, sheet]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); show(); }
      return;
    }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === "Tab" && sheet) { event.preventDefault(); cancel.current?.focus(); }
    else if (event.key === "Tab") close();
    else if (event.key === "ArrowDown") { event.preventDefault(); move(activeRef.current + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); move(activeRef.current - 1); }
    else if (event.key === "Home") { event.preventDefault(); move(0); }
    else if (event.key === "End") { event.preventDefault(); move(tabs.length - 1); }
    else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(activeRef.current); }
  };

  return <div className="browser-tab-picker">
    <span className="browser-tab-label" id={`${listId}-label`}>{t("Browser tab")}</span>
    <button ref={trigger} type="button" className="browser-tab-trigger" role="combobox" aria-labelledby={`${listId}-label`}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} disabled={disabled}
      title={selected?.url} onClick={() => open ? close() : show()} onKeyDown={keys}>
      <span className="browser-tab-title">{selected?.title || selected?.url || t("No browser tabs")}</span>
      <ChevronDown aria-hidden="true" />
    </button>
    {open && createPortal(sheet ? <div className="modal-scrim">
      <div ref={surface} className="modal row-sheet browser-tab-sheet" role="dialog" aria-modal="true" aria-labelledby={`${listId}-label`}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
          else if (event.key === "Tab" && event.target === cancel.current) { event.preventDefault(); menu.current?.focus(); }
        }}>
        <span className="row-sheet-grip" aria-hidden="true" />
        <div className="row-sheet-head"><span className="row-sheet-title">{t("Browser tab")}</span></div>
        <div ref={menu} id={listId} className="row-sheet-items browser-tab-sheet-list" role="listbox" aria-labelledby={`${listId}-label`}
          aria-activedescendant={`${listId}-${active}`} tabIndex={-1} onKeyDown={keys}>
          {tabs.map((tab, index) => <button key={tab.id} id={`${listId}-${index}`} data-tab-index={index} type="button" role="option"
            className="row-sheet-item browser-tab-option" aria-selected={tab.id === tabId} data-active={index === active || undefined}
            onPointerEnter={() => move(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(index)} title={tab.url}>
            <span className="browser-tab-option-text"><span className="browser-tab-option-title">{tab.title || tab.url}</span>
              {tab.title && tab.title !== tab.url && <span className="browser-tab-option-url">{tab.url}</span>}</span>
          </button>)}
        </div>
        <button ref={cancel} type="button" className="btn row-sheet-cancel" onClick={() => close(true)}>{t("Cancel")}</button>
      </div>
    </div> : <div ref={menu} id={listId} className="menu browser-tab-menu" role="listbox" aria-labelledby={`${listId}-label`}
      aria-activedescendant={`${listId}-${active}`} tabIndex={-1} style={place ?? { visibility: "hidden" }} onKeyDown={keys}>
      {tabs.map((tab, index) => <button key={tab.id} id={`${listId}-${index}`} data-tab-index={index} type="button" role="option"
        className="menu-item browser-tab-option" aria-selected={tab.id === tabId} data-active={index === active || undefined} onPointerEnter={() => move(index)}
        onMouseDown={(event) => event.preventDefault()} onClick={() => choose(index)} title={tab.url}>
        <span className="browser-tab-option-text"><span className="browser-tab-option-title">{tab.title || tab.url}</span>
          {tab.title && tab.title !== tab.url && <span className="browser-tab-option-url">{tab.url}</span>}</span>
      </button>)}
    </div>, document.body)}
  </div>;
}

export function BrowserView({ paneId, presentationKey, onSessionGone }: Props) {
  const t = useT();
  const onSessionGoneRef = useRef(onSessionGone);
  onSessionGoneRef.current = onSessionGone;
  const presented = useContext(PanePresentedContext);
  const shown = useContext(PaneShownContext);
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const [tabId, setTabId] = useState("");
  const tabIdRef = useRef(tabId);
  tabIdRef.current = tabId;
  const [frame, setFrame] = useState<Frame | null>(null);
  const [streamId, setStreamId] = useState("");
  const streamIdRef = useRef("");
  const [controlled, setControlled] = useState(false);
  const controlledRef = useRef(false);
  const enteringRef = useRef("");
  const swallowedKey = useRef("");
  const pressedButton = useRef<BrowserMouseButton>("none");
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [status, setStatus] = useState("");
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const [retry, setRetry] = useState(0);
  const failures = useRef(0);
  const inputQueue = useRef<BrowserInputQueue | null>(null);
  if (!inputQueue.current) inputQueue.current = new BrowserInputQueue(
    async (id, events) => post("input", { stream_id: id, events }),
    () => setStatus(t("Browser connection lost")),
  );
  const [inactive, setInactive] = useState(false);
  const explicitTabChoice = useRef(false);
  const initialDiscovery = useRef(true);
  const resumeControlTab = useRef("");
  const pendingVisibilityTab = useRef("");
  const backgroundTab = useRef("");
  const lastFramedTab = useRef("");
  const [lastVisibleTab, setLastVisibleTab] = useState("");
  const attemptedTabs = useRef(new Set<string>());
  const [selectPopup, setSelectPopup] = useState<SelectPopup | null>(null);
  const [activeOption, setActiveOption] = useState(0);
  const activeOptionRef = useRef(0);
  const popupPosition = useRef({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const [dialog, setDialog] = useState<BrowserDialog | null>(null);
  const [promptText, setPromptText] = useState("");
  const [inputMode, setInputMode] = useState<BrowserInputMode>(savedInputMode);
  const touchpadRef = useRef<TouchpadState | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [dragLocked, setDragLocked] = useState(false);
  const [feedback, setFeedback] = useState(0);
  const keyboardRef = useRef<HTMLTextAreaElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    lastFramedTab.current = "";
    setLastVisibleTab("");
    attemptedTabs.current.clear();
    controlledRef.current = false;
    if (idleTimer.current) clearTimeout(idleTimer.current);
    explicitTabChoice.current = false;
    initialDiscovery.current = true;
    resumeControlTab.current = "";
  }, [paneId]);

  useEffect(() => {
    if (!presented || !shown) return;
    let alive = true;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/pane/browser?pane_id=${encodeURIComponent(paneId)}${tabIdRef.current ? "" : "&foreground=1"}`, { cache: "no-store" });
        if (!response.ok) throw new Error("tab list");
        const body = await response.json() as { session: unknown; tabs: BrowserTab[]; foreground_tab_id?: string | null; unavailable?: boolean };
        if (!alive) return;
        setHasSession(body.session !== null);
        if (body.foreground_tab_id) setLastVisibleTab(body.foreground_tab_id);
        setTabs(body.tabs);
        setTabId((current) => body.tabs.some((tab) => tab.id === current) ? current : body.foreground_tab_id ?? body.tabs[0]?.id ?? "");
        setStatus((current) => body.unavailable || !body.session ? t("Browser unavailable") : current === t("Browser unavailable") ? "" : current);
        if (!body.session) onSessionGoneRef.current(paneId);
      } catch { if (alive) setStatus(t("Browser unavailable")); }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [paneId, presented, shown, t]);

  useEffect(() => {
    setFrame(null);
    setInactive(false);
    setStreamId("");
    streamIdRef.current = "";
    controlledRef.current = false;
    pressedButton.current = "none";
    touchpadRef.current = null;
    setCursor(null);
    setDragLocked(false);
    setControlled(false);
    setSelectPopup(null);
    setDialog(null);
    if (!tabId || !presented || !shown || hasSession !== true) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let framedThisStream = false;
    if (pendingVisibilityTab.current === tabId) {
      void (async () => {
        try {
          const response = await fetch(`/api/pane/browser?pane_id=${encodeURIComponent(paneId)}&foreground=1`, { cache: "no-store" });
          if (!response.ok) throw new Error("tab visibility");
          const body = await response.json() as { foreground_tab_id?: string | null };
          if (!alive || pendingVisibilityTab.current !== tabId) return;
          pendingVisibilityTab.current = "";
          if (body.foreground_tab_id) setLastVisibleTab(body.foreground_tab_id);
          if (body.foreground_tab_id && body.foreground_tab_id !== tabId && !controlledRef.current) {
            backgroundTab.current = tabId;
            setInactive(true);
          } else if (framedThisStream) lastFramedTab.current = tabId;
        } catch {
          if (alive && pendingVisibilityTab.current === tabId) {
            pendingVisibilityTab.current = "";
            if (framedThisStream) lastFramedTab.current = tabId;
          }
        }
      })();
    }
    setStatus((current) => current === t("Browser connection lost") ? t("Reconnecting…") : "");
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const source = new EventSource(`/api/pane/browser/stream?pane_id=${encodeURIComponent(paneId)}&tab_id=${encodeURIComponent(tabId)}${coarse ? "&max_width=1280&max_height=720&quality=45" : ""}`);
    source.addEventListener("ready", (event) => {
      if (!alive) return;
      const id = (JSON.parse((event as MessageEvent).data) as { stream_id: string }).stream_id;
      streamIdRef.current = id;
      setStreamId(id);
      if (resumeControlTab.current === tabId) {
        resumeControlTab.current = "";
        void takeControl(true);
      }
    });
    source.addEventListener("frame", (event) => {
      if (!alive) return;
      const image = JSON.parse((event as MessageEvent).data) as { data: string; width?: number; height?: number; offsetTop?: number; pageScaleFactor?: number };
      setFrame({ src: `data:image/jpeg;base64,${image.data}`, width: image.width || 1, height: image.height || 1, offsetTop: image.offsetTop || 0, pageScaleFactor: image.pageScaleFactor || 1 });
      const width = image.width || 1, height = image.height || 1;
      touchpadRef.current = touchpadRef.current
        ? browserTouchpadStep(touchpadRef.current, { kind: "resize", width, height }).state
        : createTouchpadState(width, height);
      setCursor({ x: touchpadRef.current.x, y: touchpadRef.current.y });
      framedThisStream = true;
      if (pendingVisibilityTab.current !== tabId && backgroundTab.current !== tabId) {
        lastFramedTab.current = tabId;
        setLastVisibleTab(tabId);
        initialDiscovery.current = false;
        setInactive(false);
      }
      setStatus("");
      setDisconnected(false);
      failures.current = 0;
    });
    source.addEventListener("inactive", () => {
      if (!alive) return;
      setInactive(true);
      if (!controlledRef.current && initialDiscovery.current && !explicitTabChoice.current && !resumeControlTab.current) {
        attemptedTabs.current.add(tabId);
        const next = lastFramedTab.current && lastFramedTab.current !== tabId
          ? lastFramedTab.current
          : tabsRef.current.find((tab) => !attemptedTabs.current.has(tab.id))?.id;
        if (next) {
          setTabId(next);
          return;
        }
      }
      if (!controlledRef.current) {
        void (async () => {
          try {
            const response = await fetch(`/api/pane/browser?pane_id=${encodeURIComponent(paneId)}&foreground=1`, { cache: "no-store" });
            if (!response.ok) return;
            const body = await response.json() as { foreground_tab_id?: string | null };
            if (alive && !controlledRef.current && body.foreground_tab_id && body.foreground_tab_id !== tabId) setLastVisibleTab(body.foreground_tab_id);
          } catch { /* the current selection remains available when visibility cannot be checked */ }
        })();
      }
      setStatus("");
    });
    source.addEventListener("select", (event) => {
      if (!alive || !controlledRef.current) return;
      const data = JSON.parse((event as MessageEvent).data) as { options: SelectOption[] };
      setSelectPopup({ options: data.options, ...popupPosition.current });
      activeOptionRef.current = Math.max(0, data.options.findIndex((option) => option.selected && !option.disabled));
      setActiveOption(activeOptionRef.current);
    });
    source.addEventListener("select-close", () => setSelectPopup(null));
    source.addEventListener("dialog", (event) => {
      if (!alive) return;
      const data = JSON.parse((event as MessageEvent).data) as BrowserDialog;
      setDialog(data);
      setPromptText(data.defaultPrompt);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    });
    source.addEventListener("dialog-close", () => { setDialog(null); if (controlledRef.current) resetIdle(); });
    source.onerror = () => {
      if (!alive) return;
      source.close();
      setStreamId("");
      streamIdRef.current = "";
      setControlled(false);
      controlledRef.current = false;
      pressedButton.current = "none";
      touchpadRef.current = null;
      setDragLocked(false);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      setFrame(null);
      setInactive(false);
      setDisconnected(true);
      setSelectPopup(null);
      setDialog(null);
      setStatus(t("Browser connection lost"));
      void (async () => {
        try {
          const response = await fetch(`/api/pane/browser?pane_id=${encodeURIComponent(paneId)}`, { cache: "no-store" });
          if (response.ok) {
            const body = await response.json() as { session: unknown };
            if (!alive) return;
            if (!body.session) { setHasSession(false); onSessionGoneRef.current(paneId); return; }
          }
        } catch { /* retry when the registration cannot be checked */ }
        if (!alive) return;
        const delay = Math.min(1000 * 2 ** failures.current, 8000);
        failures.current++;
        timer = setTimeout(() => setRetry((current) => current + 1), delay);
      })();
    };
    return () => {
      alive = false;
      const id = streamIdRef.current;
      if (controlledRef.current && id) {
        releaseHeldInput();
        void inputQueue.current?.drain().then(() => post("control", { stream_id: id, enabled: false })).catch(() => {})
          .finally(() => source.close());
      } else source.close();
      controlledRef.current = false;
      pressedButton.current = "none";
      if (idleTimer.current) clearTimeout(idleTimer.current);
      streamIdRef.current = "";
      if (timer) clearTimeout(timer);
    };
  }, [paneId, tabId, presented, shown, hasSession, retry, t]);

  const post = async (path: string, body: object) => {
    const response = await fetch(`/api/pane/browser/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), ...(path === "input" ? { keepalive: true } : {}) });
    if (!response.ok) throw new Error(path);
  };
  const releaseControl = async () => {
    const id = streamIdRef.current;
    releaseHeldInput();
    controlledRef.current = false;
    pressedButton.current = "none";
    setControlled(false);
    setSelectPopup(null);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (!id) return;
    try {
      await inputQueue.current?.drain();
      if (streamIdRef.current === id) await post("control", { stream_id: id, enabled: false });
    } catch { if (streamIdRef.current === id) setStatus(t("Browser connection lost")); }
  };
  const resetIdle = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => void releaseControl(), 60_000);
  };
  const takeControl = async (showTab = false) => {
    const id = streamIdRef.current;
    if (!id || controlledRef.current || enteringRef.current === id) return;
    enteringRef.current = id;
    try {
      await post("control", { stream_id: id, enabled: true, ...(showTab ? { show_tab: true } : {}) });
      if (streamIdRef.current !== id) return;
      controlledRef.current = true;
      backgroundTab.current = "";
      pendingVisibilityTab.current = "";
      setControlled(true);
      resetIdle();
    } catch { if (streamIdRef.current === id) setStatus(t("Browser connection lost")); }
    finally { if (enteringRef.current === id) enteringRef.current = ""; }
  };
  const send = (event: Input, force = false) => {
    const id = streamIdRef.current;
    if ((!controlledRef.current && !force) || !id) return;
    resetIdle();
    inputQueue.current?.enqueue(id, event, force);
  };
  const applyTouchpadAction = (action: TouchpadAction) => {
    if (action.kind === "move") {
      send({ type: "mouseMoved", x: action.x, y: action.y, button: action.buttons ? "left" : "none", buttons: action.buttons });
    } else if (action.kind === "wheel") {
      send({ type: "mouseWheel", x: action.x, y: action.y, button: "none", buttons: 0, deltaX: action.deltaX, deltaY: action.deltaY });
    } else if (action.kind === "click") {
      setFeedback((value) => value + 1);
      if (!controlledRef.current) { void takeControl(); return; }
      send({ type: "mouseMoved", x: action.x, y: action.y, button: "none", buttons: 0 });
      send({ type: "mousePressed", x: action.x, y: action.y, button: action.button, buttons: action.button === "left" ? 1 : 2, clickCount: 1 });
      send({ type: "mouseReleased", x: action.x, y: action.y, button: action.button, buttons: 0, clickCount: 1 });
    } else {
      if (action.kind === "press") setFeedback((value) => value + 1);
      send({ type: action.kind === "press" ? "mousePressed" : "mouseReleased", x: action.x, y: action.y,
        button: action.button, buttons: action.kind === "press" ? 1 : 0, clickCount: 1 }, action.kind === "release");
    }
  };
  const stepTouchpad = (event: TouchpadEvent) => {
    const state = touchpadRef.current;
    if (!state) return;
    const next = browserTouchpadStep(state, event);
    touchpadRef.current = next.state;
    setCursor({ x: next.state.x, y: next.state.y });
    setDragLocked(next.state.locked);
    // the page's select menu opens where the cursor is: Direct mode records the mouse position, Trackpad has none
    const cursorBox = next.actions.length > 0 ? imageRef.current?.closest(".browser-frame")?.querySelector(".browser-trackpad-cursor")?.getBoundingClientRect() : undefined;
    if (cursorBox) popupPosition.current = { x: cursorBox.left, y: cursorBox.bottom };
    for (const action of next.actions) applyTouchpadAction(action);
  };
  const releaseHeldInput = () => {
    if (touchpadRef.current) stepTouchpad({ kind: "reset" });
    const button = pressedButton.current;
    if (button !== "none") {
      pressedButton.current = "none";
      const state = touchpadRef.current;
      send({ type: "mouseReleased", x: state?.x ?? 0, y: state?.y ?? 0, button, buttons: 0, clickCount: 0 }, true);
    }
  };
  const touchPointer = (event: ReactPointerEvent<HTMLDivElement>, kind: "down" | "move" | "up" | "cancel") => {
    if (inputMode !== "trackpad" || event.pointerType !== "touch" || !frame || (inactive && !controlled)) return;
    event.preventDefault();
    if (kind === "down") event.currentTarget.setPointerCapture(event.pointerId);
    const width = imageRef.current?.getBoundingClientRect().width || frame.width;
    stepTouchpad({ kind, id: event.pointerId, x: event.clientX, y: event.clientY,
      at: event.timeStamp, scale: frame.width / width });
  };
  const setMode = (next: BrowserInputMode) => {
    if (next === inputMode) return;
    releaseHeldInput();
    setInputMode(next);
    try { window.localStorage.setItem(INPUT_MODE_KEY, next); } catch { /* storage can be unavailable */ }
  };
  const queueKeyboardText = (field: HTMLTextAreaElement) => {
    const id = streamIdRef.current;
    if (!id || !controlledRef.current) { field.value = ""; return; }
    inputQueue.current?.enqueueTask(async () => {
      if (streamIdRef.current !== id || !controlledRef.current) { field.value = ""; return; }
      // Text waits only in the DOM field until this turn of the input queue; it never becomes
      // React state, a draft, or a queued value.
      const value = field.value;
      field.value = "";
      for (const char of value) {
        if (char === "\n") {
          await post("input", { stream_id: id, event: { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 } });
          await post("input", { stream_id: id, event: { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 } });
        } else await post("input", { stream_id: id, event: { type: "char", key: char, code: "", windowsVirtualKeyCode: 0, text: char } });
      }
    });
  };
  useEffect(() => {
    const onBlur = () => releaseHeldInput();
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [inputMode]);
  const selectTab = (id: string) => {
    if (id === tabIdRef.current) return;
    explicitTabChoice.current = true;
    const keepControl = controlledRef.current || !!enteringRef.current || !!resumeControlTab.current;
    resumeControlTab.current = keepControl ? id : "";
    pendingVisibilityTab.current = keepControl ? "" : id;
    backgroundTab.current = "";
    setTabId(id);
  };
  const toggleControl = () => controlledRef.current ? void releaseControl() : void takeControl();
  const chooseOption = async (index: number) => {
    const id = streamIdRef.current;
    if (!id || !controlledRef.current) return;
    inputQueue.current?.enqueueTask(async () => { await post("select", { stream_id: id, index }); });
  };
  const answerDialog = async (accept: boolean) => {
    const id = streamIdRef.current;
    if (!id || !controlledRef.current) return;
    inputQueue.current?.enqueueTask(async () => { await post("dialog", { stream_id: id, accept, ...(dialog?.type === "prompt" ? { promptText } : {}) }); });
  };
  useLayoutEffect(() => {
    if (!selectPopup) return;
    menuRef.current?.focus();
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setSelectPopup(null); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [selectPopup]);
  const point = (event: MouseEvent<HTMLImageElement> | WheelEvent<HTMLImageElement>) => {
    return browserInputPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(), frame!);
  };
  const keyInput = (event: KeyboardEvent<HTMLImageElement>, type: "keyDown" | "keyUp" | "char", text?: string): Input => ({
    type, key: event.key, code: event.code, windowsVirtualKeyCode: browserVirtualKeyCode(event.code, event.keyCode),
    modifiers: browserModifiers(event), ...(text === undefined ? {} : { text }),
  });

  const backTabId = lastVisibleTab !== tabId ? lastVisibleTab : lastFramedTab.current;
  const backTab = tabs.find((tab) => tab.id === backTabId && tab.id !== tabId);
  return <section className="browser-view" aria-label={t("Browser")} data-pane-content={presented && shown && frame ? presentationKey : undefined}>
    <div className="browser-toolbar">
      <BrowserTabPicker tabs={tabs} tabId={tabId} onChange={selectTab} disabled={tabs.length === 0} />
      <div className="segmented browser-input-modes" role="group" aria-label={t("Browser input mode")}>
        <button type="button" aria-pressed={inputMode === "direct"} onClick={() => setMode("direct")}>{t("Direct")}</button>
        <button type="button" aria-pressed={inputMode === "trackpad"} onClick={() => setMode("trackpad")}>{t("Trackpad")}</button>
      </div>
      {controlled && <span className="browser-control-label" role="status">{t("Controlling")}</span>}
      <button type="button" className="btn browser-control-button" aria-label={controlled ? t("Release") : t("Take control")} title={controlled ? t("Release") : t("Take control")} aria-pressed={controlled} disabled={!streamId} onClick={toggleControl}><span className="browser-control-icon" aria-hidden="true">{controlled ? <X /> : <MousePointer2 />}</span><span className="browser-control-text">{controlled ? t("Release") : t("Take control")}</span></button>
    </div>
    {status && <div className="browser-status" role="status"><span>{status}</span>{disconnected && hasSession && tabId && <button type="button" className="btn" onClick={() => { failures.current = 0; setRetry((current) => current + 1); }}>{t("Reconnect")}</button>}</div>}
    {!tabId && !status && <p className="browser-status">{t("No browser tabs")}</p>}
    {tabId && !frame && !status && !inactive && <p className="browser-status">{t("Loading browser…")}</p>}
    {(frame || inactive) && <div className={`browser-frame${controlled ? " is-controlling" : ""}${inputMode === "trackpad" ? " is-trackpad" : ""}`}
      onPointerDown={(event) => touchPointer(event, "down")}
      onPointerMove={(event) => touchPointer(event, "move")}
      onPointerUp={(event) => touchPointer(event, "up")}
      onPointerCancel={(event) => touchPointer(event, "cancel")}>
      {frame && <div className="browser-image-wrap">
      <img ref={imageRef} src={frame.src} alt={t("Browser tab screenshot")} tabIndex={0} draggable={false}
        onMouseDown={(event) => {
          if (inputMode === "trackpad") return;
          event.preventDefault();
          event.currentTarget.focus();
          if (!controlledRef.current) { void takeControl(); return; }
          const button = browserMouseButton(event.button);
          if (button === "none") return;
          popupPosition.current = { x: event.clientX, y: event.clientY };
          pressedButton.current = button;
          const pos = point(event);
          send({ type: "mouseMoved", ...pos, button: "none", buttons: 0, modifiers: browserModifiers(event) });
          send({ type: "mousePressed", ...pos, button, buttons: event.buttons, clickCount: Math.max(1, Math.min(event.detail, 2)), modifiers: browserModifiers(event) });
        }}
        onMouseMove={(event) => {
          if (inputMode === "trackpad") return;
          if (!controlledRef.current) return;
          send({ type: "mouseMoved", ...point(event), button: pressedButton.current, buttons: event.buttons, modifiers: browserModifiers(event) });
        }}
        onMouseUp={(event) => {
          if (inputMode === "trackpad") return;
          if (!controlledRef.current || pressedButton.current === "none") return;
          send({ type: "mouseReleased", ...point(event), button: pressedButton.current, buttons: event.buttons, clickCount: Math.max(1, Math.min(event.detail, 2)), modifiers: browserModifiers(event) });
          pressedButton.current = "none";
        }}
        onMouseLeave={(event) => {
          if (inputMode === "trackpad") return;
          if (pressedButton.current === "none") return;
          send({ type: "mouseReleased", ...point(event), button: pressedButton.current, buttons: 0, clickCount: 0, modifiers: browserModifiers(event) });
          pressedButton.current = "none";
        }}
        onContextMenu={(event) => event.preventDefault()}
        onDragStart={(event) => event.preventDefault()}
        onWheel={(event) => {
          if (!controlledRef.current) return;
          event.preventDefault();
          send({ type: "mouseWheel", ...point(event), button: "none", buttons: 0,
            deltaX: browserWheelDelta(event.deltaX, event.deltaMode, frame.height),
            deltaY: browserWheelDelta(event.deltaY, event.deltaMode, frame.height), modifiers: browserModifiers(event) });
        }}
        onKeyDown={(event) => {
          if (!controlledRef.current) { event.preventDefault(); swallowedKey.current = event.code; void takeControl(); return; }
          event.preventDefault();
          if (event.key === "Escape") { void releaseControl(); return; }
          send(keyInput(event, "keyDown"));
          if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) send(keyInput(event, "char", event.key));
        }}
        onKeyUp={(event) => {
          if (swallowedKey.current === event.code) { swallowedKey.current = ""; event.preventDefault(); return; }
          if (!controlledRef.current || event.key === "Escape") return;
          event.preventDefault();
          send(keyInput(event, "keyUp"));
        }} />
      {inputMode === "trackpad" && cursor && <span className="browser-trackpad-cursor" aria-hidden="true"
        style={{ left: `${cursor.x / frame.width * 100}%`, top: `${(cursor.y + frame.offsetTop) / frame.height * 100}%` }}><MousePointer2 />{feedback > 0 && <span key={feedback} className="browser-cursor-feedback" />}</span>}
      </div>}
      {inactive && !controlled && <div className="browser-background-overlay">
        <div className="browser-background-card">
          <p role="status">{t("This tab is in the background in Chrome")}</p>
          <div className="browser-background-actions">
            <button type="button" className="btn btn-primary" disabled={!streamId} onClick={() => void takeControl(true)}>{t("Show this tab")}</button>
            {backTab && <button type="button" className="btn" onClick={() => selectTab(backTab.id)}>{t("Back to {title}", { title: backTab.title || backTab.url })}</button>}
          </div>
        </div>
      </div>}
    </div>}
    {frame && inputMode === "trackpad" && <div className="browser-trackpad-controls">
      <button type="button" className="btn" onClick={() => {
        const state = touchpadRef.current;
        if (state) applyTouchpadAction({ kind: "click", button: "right", x: state.x, y: state.y });
      }}><MousePointerClick aria-hidden="true" />{t("Right click")}</button>
      <button type="button" className="btn" onClick={() => {
        keyboardRef.current?.focus();
        if (!controlledRef.current) void takeControl();
      }}><Keyboard aria-hidden="true" />{t("Keyboard")}</button>
      <button type="button" className="btn" aria-pressed={dragLocked} onClick={() => {
        if (!controlledRef.current) { void takeControl().then(() => { if (controlledRef.current) stepTouchpad({ kind: "lock", enabled: true }); }); return; }
        stepTouchpad({ kind: "lock", enabled: !touchpadRef.current?.locked });
      }}><LockKeyhole aria-hidden="true" />{t("Drag lock")}</button>
      <textarea ref={keyboardRef} className="browser-keyboard-input" aria-label={t("Browser keyboard")} autoComplete="off" autoCapitalize="none" spellCheck={false}
        onInput={(event) => {
          queueKeyboardText(event.currentTarget);
        }}
        onKeyDown={(event) => {
          if (!["Backspace", "Enter", "Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault();
          const code = event.code || event.key;
          const windowsVirtualKeyCode = browserVirtualKeyCode(code, event.keyCode);
          send({ type: "keyDown", key: event.key, code, windowsVirtualKeyCode });
          send({ type: "keyUp", key: event.key, code, windowsVirtualKeyCode });
        }} />
    </div>}
    {selectPopup && createPortal(<div ref={menuRef} className="menu browser-select-menu" role="listbox" aria-label={t("Choose option")}
      tabIndex={-1} style={{ left: Math.min(selectPopup.x, window.innerWidth - 220), top: Math.min(selectPopup.y, window.innerHeight - 240) }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); setSelectPopup(null); return; }
        if (event.key === "Enter") { event.preventDefault(); const index = activeOptionRef.current; if (!selectPopup.options[index]?.disabled) void chooseOption(index); return; }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        let next = activeOptionRef.current;
        for (let count = 0; count < selectPopup.options.length; count++) {
          next = (next + direction + selectPopup.options.length) % selectPopup.options.length;
          if (!selectPopup.options[next]?.disabled) { activeOptionRef.current = next; setActiveOption(next); break; }
        }
      }}>
      {selectPopup.options.map((option, index) => <button key={index} type="button" className="menu-item" role="option" aria-selected={index === activeOption}
        disabled={option.disabled} onMouseEnter={() => { activeOptionRef.current = index; setActiveOption(index); }} onClick={() => void chooseOption(index)}>
        <span className="menu-item-main">{option.group ? `${option.group} · ` : ""}{option.label}</span>{option.selected && <span aria-hidden="true">✓</span>}
      </button>)}
    </div>, document.body)}
    {dialog && createPortal(<div className="modal-scrim"><div className="modal browser-dialog" role="alertdialog" aria-modal="true" aria-label={t("Browser dialog")}
      onKeyDown={(event) => { if (event.key === "Escape" && dialog.type !== "alert") { event.preventDefault(); void answerDialog(false); } }}>
      <div className="modal-header"><strong className="modal-title">{t("Browser dialog")}</strong></div>
      <div className="modal-body"><p>{dialog.message}</p>{dialog.type === "prompt" && <input autoFocus aria-label={t("Response")} value={promptText} onChange={(event) => setPromptText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void answerDialog(true); } }} />}</div>
      <div className="modal-footer">{!controlled && <button className="btn" type="button" onClick={() => void takeControl()}>{t("Take control")}</button>}{dialog.type !== "alert" && <button className="btn" type="button" disabled={!controlled} onClick={() => void answerDialog(false)}>{t("Cancel")}</button>}<button className="btn" type="button" disabled={!controlled} autoFocus={dialog.type !== "prompt" && controlled} onClick={() => void answerDialog(true)}>{t("OK")}</button></div>
    </div></div>, document.body)}
  </section>;
}
