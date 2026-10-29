export interface ScreencastSize {
  width: number;
  height: number;
  offsetTop: number;
  pageScaleFactor: number;
}

export type BrowserMouseButton = "none" | "left" | "middle" | "right";
export const browserMouseButton = (button: number): BrowserMouseButton => button === 0 ? "left" : button === 1 ? "middle" : button === 2 ? "right" : "none";

export function browserModifiers(event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">): number {
  return Number(event.altKey) | (Number(event.ctrlKey) << 1) | (Number(event.metaKey) << 2) | (Number(event.shiftKey) << 3);
}

export function browserWheelDelta(delta: number, deltaMode: number, viewportHeight: number): number {
  return delta * (deltaMode === 1 ? 16 : deltaMode === 2 ? viewportHeight : 1);
}

/** A fallback for browsers that leave the deprecated DOM keyCode at zero. */
export function browserVirtualKeyCode(code: string, keyCode: number): number {
  if (keyCode > 0) return keyCode;
  const special: Record<string, number> = {
    Backspace: 8, Tab: 9, Enter: 13, ShiftLeft: 16, ShiftRight: 16, ControlLeft: 17, ControlRight: 17,
    AltLeft: 18, AltRight: 18, Pause: 19, CapsLock: 20, Escape: 27, Space: 32, PageUp: 33,
    PageDown: 34, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
    Insert: 45, Delete: 46, MetaLeft: 91, MetaRight: 92,
  };
  if (special[code] !== undefined) return special[code];
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3);
  if (/^Digit[0-9]$/.test(code)) return code.charCodeAt(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return 111 + Number(code.slice(1));
  return 0;
}

/** CDP mouse coordinates are viewport CSS pixels, even when the JPEG has Retina pixels. */
export function browserInputPoint(clientX: number, clientY: number, box: Pick<DOMRect, "left" | "top" | "width" | "height">, frame: ScreencastSize) {
  const zoom = box.width / frame.width;
  return {
    x: Math.max(0, Math.min(frame.width, Math.round((clientX - box.left) / zoom))),
    y: Math.max(0, Math.min(frame.height, Math.round((clientY - box.top) / zoom - frame.offsetTop))),
  };
}
