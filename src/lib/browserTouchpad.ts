export type TouchpadAction =
  | { kind: "move"; x: number; y: number; buttons: number }
  | { kind: "click"; button: "left" | "right"; x: number; y: number }
  | { kind: "press" | "release"; button: "left"; x: number; y: number }
  | { kind: "wheel"; x: number; y: number; deltaX: number; deltaY: number };

type Point = { readonly id: number; readonly startX: number; readonly startY: number; readonly x: number; readonly y: number };
export type TouchpadState = {
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
  readonly points: readonly Point[];
  readonly gesture: "none" | "one" | "two";
  readonly startedAt: number;
  readonly moved: boolean;
  readonly lastTapAt: number | null;
  readonly dragArmed: boolean;
  readonly dragging: boolean;
  readonly locked: boolean;
};

export type TouchpadEvent =
  | { kind: "down" | "move" | "up" | "cancel"; id: number; x: number; y: number; at: number; scale: number }
  | { kind: "lock"; enabled: boolean }
  | { kind: "resize"; width: number; height: number }
  | { kind: "reset" };

const MOVE_THRESHOLD = 8;
const TAP_MS = 350;
const DRAG_WINDOW_MS = 300;
const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));

export function createTouchpadState(width: number, height: number): TouchpadState {
  return { width, height, x: width / 2, y: height / 2, points: [], gesture: "none", startedAt: 0,
    moved: false, lastTapAt: null, dragArmed: false, dragging: false, locked: false };
}

export function browserTouchpadStep(state: TouchpadState, event: TouchpadEvent): { state: TouchpadState; actions: TouchpadAction[] } {
  const actions: TouchpadAction[] = [];
  if (event.kind === "resize") return { state: { ...state, width: event.width, height: event.height,
    x: clamp(state.x, event.width), y: clamp(state.y, event.height) }, actions };
  if (event.kind === "reset" || event.kind === "cancel") {
    if (state.dragging || state.locked) actions.push({ kind: "release", button: "left", x: state.x, y: state.y });
    return { state: { ...state, points: [], gesture: "none", moved: false, lastTapAt: null,
      dragArmed: false, dragging: false, locked: false }, actions };
  }
  if (event.kind === "lock") {
    if (event.enabled === state.locked) return { state, actions };
    if (event.enabled && !state.dragging) actions.push({ kind: "press", button: "left", x: state.x, y: state.y });
    if (!event.enabled) actions.push({ kind: "release", button: "left", x: state.x, y: state.y });
    return { state: { ...state, locked: event.enabled, dragging: event.enabled ? state.dragging : false }, actions };
  }
  if (event.kind === "down") {
    const point: Point = { id: event.id, startX: event.x, startY: event.y, x: event.x, y: event.y };
    if (state.points.length === 0) return { state: { ...state, points: [point], gesture: "one", startedAt: event.at,
      moved: false, dragArmed: state.lastTapAt !== null && event.at - state.lastTapAt <= DRAG_WINDOW_MS }, actions };
    if (state.gesture === "one" && state.dragging && !state.locked) actions.push({ kind: "release", button: "left", x: state.x, y: state.y });
    return { state: { ...state, points: [...state.points, point], gesture: "two", startedAt: event.at,
      moved: false, lastTapAt: null, dragArmed: false, dragging: false }, actions };
  }
  const point = state.points.find((entry) => entry.id === event.id);
  if (!point) return { state, actions };
  const points = event.kind === "up" ? state.points.filter((entry) => entry.id !== event.id)
    : state.points.map((entry) => entry.id === event.id ? { ...entry, x: event.x, y: event.y } : entry);
  if (event.kind === "up") {
    if (state.gesture === "one" && points.length === 0) {
      if (state.dragging && !state.locked) actions.push({ kind: "release", button: "left", x: state.x, y: state.y });
      else if (!state.moved && !state.locked && event.at - state.startedAt <= TAP_MS)
        actions.push({ kind: "click", button: "left", x: state.x, y: state.y });
      return { state: { ...state, points, gesture: "none", dragging: false, dragArmed: false,
        lastTapAt: !state.moved && !state.dragging ? event.at : null }, actions };
    }
    if (state.gesture === "two" && points.length === 0) {
      if (!state.moved && event.at - state.startedAt <= TAP_MS && !state.locked)
        actions.push({ kind: "click", button: "right", x: state.x, y: state.y });
      return { state: { ...state, points, gesture: "none", lastTapAt: null }, actions };
    }
    return { state: { ...state, points }, actions };
  }
  const dx = (event.x - point.x) * event.scale;
  const dy = (event.y - point.y) * event.scale;
  const moved = state.moved || Math.hypot(event.x - point.startX, event.y - point.startY) >= MOVE_THRESHOLD;
  if (state.gesture === "two") {
    if (moved) actions.push({ kind: "wheel", x: state.x, y: state.y, deltaX: dx ? -dx / 2 : 0, deltaY: dy ? -dy / 2 : 0 });
    return { state: { ...state, points, moved }, actions };
  }
  const x = clamp(state.x + dx, state.width);
  const y = clamp(state.y + dy, state.height);
  const dragging = state.dragging || state.dragArmed && moved && !state.locked;
  if (dragging && !state.dragging) actions.push({ kind: "press", button: "left", x: state.x, y: state.y });
  if (dx || dy) actions.push({ kind: "move", x, y, buttons: Number(dragging || state.locked) });
  return { state: { ...state, points, moved, dragging, x, y }, actions };
}
