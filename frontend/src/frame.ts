// Decode binary frames: [uint32 LE header_len][msgpack header][payload].
// Mirror of sigui2/server/encode.py.
import { decode } from "@msgpack/msgpack";

export interface BufferDesc {
  name: string;
  dtype: string;
  shape: number[];
  offset: number;
  nbytes: number;
}
export interface FrameHeader {
  type: string;
  buffers: BufferDesc[];
  [k: string]: unknown;
}
export type TypedArray = Float32Array | Float64Array | Uint8Array | Int32Array;
export interface DecodedFrame {
  header: FrameHeader;
  buffers: Record<string, TypedArray>;
}

function makeTyped(dtype: string, buf: ArrayBuffer): TypedArray {
  switch (dtype) {
    case "<f4": return new Float32Array(buf);
    case "<f8": return new Float64Array(buf);
    case "|u1": return new Uint8Array(buf);
    case "<i4": return new Int32Array(buf);
    default: throw new Error(`unsupported dtype ${dtype}`);
  }
}

export function decodeFrame(data: ArrayBuffer): DecodedFrame {
  const dv = new DataView(data);
  const hlen = dv.getUint32(0, true);
  const header = decode(new Uint8Array(data, 4, hlen)) as unknown as FrameHeader;
  const payloadStart = 4 + hlen;
  const buffers: Record<string, TypedArray> = {};
  for (const b of header.buffers) {
    const start = payloadStart + b.offset;
    // slice() copies into a fresh 0-aligned ArrayBuffer (typed arrays need
    // element alignment, which concatenated payload offsets don't guarantee).
    buffers[b.name] = makeTyped(b.dtype, data.slice(start, start + b.nbytes));
  }
  return { header, buffers };
}
