// Main-thread handle to the data-plane WebWorker. The WebSocket and binary
// frame decode live in the worker (worker.ts); this class just proxies the same
// API the views used before, so nothing downstream changes.
//
// Binary replies are strictly ordered per request, so a FIFO of resolvers
// matches each reply to its request (Phase 0/1). A future epoch tag will let us
// discard stale frames on rapid pan/zoom.
import { DecodedFrame } from "./frame";

export class Sock {
  private worker: Worker;
  // Per-reply-type FIFO of resolvers, so independent requesters (trace vs
  // scatter) can never consume each other's frames.
  private frameQueues: Record<string, ((f: DecodedFrame) => void)[]> = {};
  private jsonHandlers: Record<string, (m: any) => void> = {};
  private readyResolve!: () => void;
  ready: Promise<void>;

  constructor(url: string) {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.ready = new Promise((res) => (this.readyResolve = res));
    this.worker.onmessage = (ev) => this.onMessage(ev.data);
    this.worker.postMessage({ cmd: "connect", url });
  }

  private onMessage(m: any) {
    if (m.kind === "open") this.readyResolve();
    else if (m.kind === "json") this.jsonHandlers[m.msg.type]?.(m.msg);
    else if (m.kind === "frame") {
      const type = m.header.type as string;
      (this.frameQueues[type] ||= []).shift()?.({ header: m.header, buffers: m.buffers });
    }
  }

  on(type: string, fn: (m: any) => void) {
    this.jsonHandlers[type] = fn;
  }
  send(msg: unknown) {
    this.worker.postMessage({ cmd: "send", msg });
  }
  /** Send `msg` and resolve with the next frame of `replyType`. */
  requestFrame(msg: unknown, replyType: string): Promise<DecodedFrame> {
    return new Promise((res) => {
      (this.frameQueues[replyType] ||= []).push(res);
      this.send(msg);
    });
  }
}
