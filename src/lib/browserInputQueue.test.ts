import { describe, expect, it } from "bun:test";
import { BrowserInputQueue, type BrowserInput } from "./browserInputQueue.ts";

const move = (x: number): BrowserInput => ({ type: "mouseMoved", x, y: 0, button: "none", buttons: 0 });
const wheel = (deltaY: number): BrowserInput => ({ type: "mouseWheel", x: 0, y: 0, button: "none", buttons: 0, deltaX: 0, deltaY });

function blockedQueue() {
  const sent: BrowserInput[] = [];
  let unblock = () => {};
  const blocker = new Promise<void>((resolve) => { unblock = resolve; });
  const queue = new BrowserInputQueue(async (_id, events) => { sent.push(...events); }, () => { throw new Error("send failed"); }, async () => {});
  queue.enqueueTask(() => blocker);
  return { queue, sent, unblock };
}

describe("browser input queue", () => {
  it("sends only the latest adjacent move while input is blocked", async () => {
    const { queue, sent, unblock } = blockedQueue();
    queue.enqueue("s", move(1)); queue.enqueue("s", move(2)); queue.enqueue("s", move(3));
    unblock(); await queue.drain();
    expect(sent).toEqual([move(3)]);
  });
  it("keeps the latest move on each side of press and release", async () => {
    const { queue, sent, unblock } = blockedQueue();
    const press = { type: "mousePressed", x: 2, y: 0, button: "left" as const };
    const release = { type: "mouseReleased", x: 4, y: 0, button: "left" as const };
    queue.enqueue("s", move(1)); queue.enqueue("s", move(2)); queue.enqueue("s", press);
    queue.enqueue("s", move(3)); queue.enqueue("s", move(4)); queue.enqueue("s", release);
    unblock(); await queue.drain();
    expect(sent).toEqual([move(2), press, move(4), release]);
  });
  it("sends a move, press and release together in order", async () => {
    const batches: BrowserInput[][] = [];
    const queue = new BrowserInputQueue(async (_id, events) => { batches.push([...events]); }, () => { throw new Error("send failed"); }, async () => {});
    const press: BrowserInput = { type: "mousePressed", x: 2, y: 0, button: "right" };
    const release: BrowserInput = { type: "mouseReleased", x: 2, y: 0, button: "right" };
    queue.enqueue("s", move(2)); queue.enqueue("s", press); queue.enqueue("s", release);
    await queue.drain();
    expect(batches).toEqual([[move(2), press, release]]);
  });
  it("adds adjacent wheel deltas without crossing other input", async () => {
    const { queue, sent, unblock } = blockedQueue();
    queue.enqueue("s", wheel(2)); queue.enqueue("s", wheel(-5)); queue.enqueue("s", move(3)); queue.enqueue("s", wheel(4));
    unblock(); await queue.drain();
    expect(sent).toEqual([wheel(-3), move(3), wheel(4)]);
  });
});
