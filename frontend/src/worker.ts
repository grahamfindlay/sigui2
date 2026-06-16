// Data-plane WebWorker: owns the WebSocket and decodes binary frames off the
// main thread, so frame decode never competes with deck.gl rendering. Decoded
// buffers are transferred (zero-copy) to the main thread.
import { decodeFrame } from "./frame";

let ws: WebSocket | null = null;

self.onmessage = (ev: MessageEvent) => {
  const m = ev.data;
  if (m.cmd === "connect") {
    ws = new WebSocket(m.url);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => (self as unknown as Worker).postMessage({ kind: "open" });
    ws.onclose = () => (self as unknown as Worker).postMessage({ kind: "close" });
    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        (self as unknown as Worker).postMessage({ kind: "json", msg: JSON.parse(e.data) });
      } else {
        const f = decodeFrame(e.data as ArrayBuffer);
        const transfers = Object.values(f.buffers).map((a) => a.buffer);
        (self as unknown as Worker).postMessage(
          { kind: "frame", header: f.header, buffers: f.buffers },
          transfers,
        );
      }
    };
  } else if (m.cmd === "send") {
    ws?.send(JSON.stringify(m.msg));
  }
};
