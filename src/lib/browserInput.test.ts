import { describe, expect, it } from "bun:test";
import { browserInputPoint, browserModifiers, browserMouseButton, browserVirtualKeyCode, browserWheelDelta } from "./browserInput.ts";

describe("browser screencast input", () => {
  it("maps a Retina JPEG through CDP viewport metadata and its top offset", () => {
    const frame = { width: 800, height: 600, offsetTop: 12, pageScaleFactor: 1 };
    const box = { left: 30, top: 20, width: 400, height: 300 };
    expect(browserInputPoint(130, 90, box, frame)).toEqual({ x: 200, y: 128 });
  });
  it("maps right and middle buttons and CDP modifier bits", () => {
    expect([0, 1, 2].map(browserMouseButton)).toEqual(["left", "middle", "right"]);
    expect(browserModifiers({ altKey: true, ctrlKey: true, metaKey: false, shiftKey: true })).toBe(11);
  });
  it("converts line and page wheel units to viewport pixels", () => {
    expect(browserWheelDelta(2, 1, 600)).toBe(32);
    expect(browserWheelDelta(-1, 2, 600)).toBe(-600);
  });
  it("supplies virtual key codes for arrows, Tab, letters, and modifiers", () => {
    expect(["ArrowLeft", "Tab", "KeyA", "ShiftLeft", "ControlLeft"].map((code) => browserVirtualKeyCode(code, 0)))
      .toEqual([37, 9, 65, 16, 17]);
    expect(browserVirtualKeyCode("KeyA", 42)).toBe(42);
  });
});
