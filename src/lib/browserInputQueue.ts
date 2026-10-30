import type { BrowserMouseButton } from "./browserInput.ts";

export type BrowserInput = { type: string; key?: string; code?: string; windowsVirtualKeyCode?: number; text?: string; x?: number; y?: number; button?: BrowserMouseButton; buttons?: number; clickCount?: number; deltaX?: number; deltaY?: number; modifiers?: number };
type InputEntry = { kind: "input"; event: BrowserInput; streamId: string; force: boolean };
type Entry = InputEntry | { kind: "task"; task: () => Promise<void> };

/** Serializes input batches while replacing adjacent pending motion and accumulating wheels. */
export class BrowserInputQueue {
  private readonly entries: Entry[] = [];
  private running: Promise<void> | undefined;

  constructor(private readonly send: (streamId: string, events: readonly BrowserInput[], force: boolean) => Promise<void>,
    private readonly onError: () => void,
    // fixed wait: rate-limit pointer batches and collect motion during the interval.
    private readonly pace: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 17))) {}

  enqueue(streamId: string, event: BrowserInput, force = false): void {
    const previous = this.entries.at(-1);
    const mergeable = previous?.kind === "input" && previous.streamId === streamId && previous.force === force &&
      previous.event.type === event.type && previous.event.modifiers === event.modifiers &&
      previous.event.button === event.button && previous.event.buttons === event.buttons;
    if (mergeable && event.type === "mouseMoved") previous.event = event;
    else if (mergeable && event.type === "mouseWheel") {
      previous.event = { ...event, deltaX: (previous.event.deltaX ?? 0) + (event.deltaX ?? 0), deltaY: (previous.event.deltaY ?? 0) + (event.deltaY ?? 0) };
    } else this.entries.push({ kind: "input", event, streamId, force });
    this.start();
  }

  enqueueTask(task: () => Promise<void>): void {
    this.entries.push({ kind: "task", task });
    this.start();
  }

  private start(): void {
    if (this.running) return;
    this.running = Promise.resolve().then(async () => {
      while (this.entries.length) {
        const first = this.entries[0];
        if (!first) break;
        try {
          if (first.kind === "task") { this.entries.shift(); await first.task(); continue; }
          if (first.event.type === "mouseMoved" || first.event.type === "mouseWheel") await this.pace();
          const events: BrowserInput[] = [];
          while (events.length < 64) {
            const next = this.entries[0];
            if (!next || next.kind !== "input" || next.streamId !== first.streamId || next.force !== first.force) break;
            events.push(next.event);
            this.entries.shift();
          }
          await this.send(first.streamId, events, first.force);
        } catch { this.onError(); }
      }
    }).finally(() => { this.running = undefined; if (this.entries.length) this.start(); });
  }

  async drain(): Promise<void> { while (this.running) await this.running; }
}
