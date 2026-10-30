import { describe, expect, it } from "bun:test";
import { browserTouchpadStep, createTouchpadState, type TouchpadEvent, type TouchpadState } from "./browserTouchpad.ts";

const pointer = (kind: "down" | "move" | "up" | "cancel", id: number, x: number, y: number, at: number): Extract<TouchpadEvent, { kind: "down" | "move" | "up" | "cancel" }> =>
  ({ kind, id, x, y, at, scale: 1 });
const run = (initial: TouchpadState, ...events: TouchpadEvent[]) => events.reduce((history, event) => {
  const next = browserTouchpadStep(history.state, event);
  return { state: next.state, actions: [...history.actions, ...next.actions] };
}, { state: initial, actions: [] as ReturnType<typeof browserTouchpadStep>["actions"] });

describe("browser touchpad gestures", () => {
  it("clicks on a short tap but moves the cursor without clicking past the threshold", () => {
    const start = createTouchpadState(200, 100);
    expect(run(start, pointer("down", 1, 10, 10, 0), pointer("move", 1, 14, 13, 40), pointer("up", 1, 14, 13, 80)).actions.at(-1))
      .toEqual({ kind: "click", button: "left", x: 104, y: 53 });
    const moved = run(start, pointer("down", 1, 10, 10, 0), pointer("move", 1, 20, 10, 40), pointer("up", 1, 20, 10, 80));
    expect(moved.actions).toEqual([{ kind: "move", x: 110, y: 50, buttons: 0 }]);
  });

  it("treats a two-finger tap as right click and a two-finger movement as wheel only", () => {
    const start = createTouchpadState(200, 100);
    const tapped = run(start, pointer("down", 1, 10, 10, 0), pointer("down", 2, 30, 10, 20),
      pointer("up", 1, 10, 10, 80), pointer("up", 2, 30, 10, 100));
    expect(tapped.actions).toEqual([{ kind: "click", button: "right", x: 100, y: 50 }]);
    const scrolled = run(start, pointer("down", 1, 10, 10, 0), pointer("down", 2, 30, 10, 20),
      pointer("move", 1, 10, -10, 40), pointer("move", 2, 30, -10, 50), pointer("up", 1, 10, -10, 90), pointer("up", 2, 30, -10, 100));
    expect(scrolled.actions).toEqual([
      { kind: "wheel", x: 100, y: 50, deltaX: 0, deltaY: 10 },
      { kind: "wheel", x: 100, y: 50, deltaX: 0, deltaY: 10 },
    ]);
  });

  it("starts a drag on a move after a recent tap, then releases on lift", () => {
    const start = createTouchpadState(200, 100);
    const dragged = run(start, pointer("down", 1, 10, 10, 0), pointer("up", 1, 10, 10, 60),
      pointer("down", 1, 10, 10, 200), pointer("move", 1, 20, 10, 230), pointer("up", 1, 20, 10, 260));
    expect(dragged.actions).toEqual([
      { kind: "click", button: "left", x: 100, y: 50 },
      { kind: "press", button: "left", x: 100, y: 50 },
      { kind: "move", x: 110, y: 50, buttons: 1 },
      { kind: "release", button: "left", x: 110, y: 50 },
    ]);
    const late = run(start, pointer("down", 1, 10, 10, 0), pointer("up", 1, 10, 10, 60),
      pointer("down", 1, 10, 10, 400), pointer("move", 1, 20, 10, 430));
    expect(late.actions.some((action) => action.kind === "press")).toBe(false);
  });

  it("holds drag lock across lifts and releases it when toggled off", () => {
    const actions = run(createTouchpadState(200, 100), { kind: "lock", enabled: true },
      pointer("down", 1, 10, 10, 0), pointer("move", 1, 20, 10, 20), pointer("up", 1, 20, 10, 40), { kind: "lock", enabled: false }).actions;
    expect(actions).toEqual([
      { kind: "press", button: "left", x: 100, y: 50 },
      { kind: "move", x: 110, y: 50, buttons: 1 },
      { kind: "release", button: "left", x: 110, y: 50 },
    ]);
  });

  it("clamps relative movement to the viewport", () => {
    const result = run(createTouchpadState(200, 100), pointer("down", 1, 0, 0, 0),
      { ...pointer("move", 1, 200, -100, 20), scale: 2 });
    expect(result.state).toMatchObject({ x: 200, y: 0 });
    expect(result.actions.at(-1)).toEqual({ kind: "move", x: 200, y: 0, buttons: 0 });
  });

  it("releases any held button on pointercancel or reset", () => {
    const locked = run(createTouchpadState(200, 100), { kind: "lock", enabled: true }, pointer("cancel", 1, 0, 0, 20));
    expect(locked.actions.at(-1)).toEqual({ kind: "release", button: "left", x: 100, y: 50 });
    expect(locked.state.locked).toBe(false);
    const dragging = run(createTouchpadState(200, 100), pointer("down", 1, 0, 0, 0), pointer("up", 1, 0, 0, 20),
      pointer("down", 1, 0, 0, 100), pointer("move", 1, 12, 0, 120), { kind: "reset" });
    expect(dragging.actions.at(-1)).toEqual({ kind: "release", button: "left", x: 112, y: 50 });
    expect(dragging.state.dragging).toBe(false);
  });
});
