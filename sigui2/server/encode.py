"""Binary frame encoding for the data plane.

Frame layout on the wire:

    [uint32 LE: header_len][msgpack header][payload bytes]

The header is a small msgpack dict that always carries a ``buffers`` list, each
entry ``{name, dtype, shape, offset, nbytes}`` describing a slice of the
contiguous ``payload``. The browser reads each buffer zero-copy into the matching
typed array (``<f4`` -> Float32Array, ``|u1`` -> Uint8Array, ``<i4`` ->
Int32Array) and uploads it straight to the GPU.

This replaces the current Panel path's per-refresh JSON of Python lists + hex
color strings.
"""

from __future__ import annotations

import struct

import msgpack
import numpy as np


class FrameBuilder:
    """Accumulate named numpy arrays into one binary frame."""

    def __init__(self) -> None:
        self._buffers: list[dict] = []
        self._parts: list[bytes] = []
        self._offset = 0

    def add(self, name: str, arr: np.ndarray) -> "FrameBuilder":
        arr = np.ascontiguousarray(arr)
        raw = arr.tobytes()
        self._buffers.append(
            {
                "name": name,
                "dtype": arr.dtype.str,  # e.g. '<f4', '|u1', '<i4'
                "shape": list(arr.shape),
                "offset": self._offset,
                "nbytes": len(raw),
            }
        )
        self._parts.append(raw)
        self._offset += len(raw)
        return self

    def build(self, header: dict) -> bytes:
        header = dict(header)
        header["buffers"] = self._buffers
        packed = msgpack.packb(header, use_bin_type=True)
        return struct.pack("<I", len(packed)) + packed + b"".join(self._parts)


def encode_frame(header: dict, arrays: dict[str, np.ndarray]) -> bytes:
    """Convenience: build a frame from a {name: array} mapping."""
    fb = FrameBuilder()
    for name, arr in arrays.items():
        fb.add(name, arr)
    return fb.build(header)
