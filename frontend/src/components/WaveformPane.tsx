import { useEffect, useRef, useState } from "react";
import { Sock } from "../socket";
import { Meta, UnitId } from "../types";
import { WaveformView, RGB } from "../waveformView";
import { CachedUnitView } from "../unitCache";
import { DecodedFrame } from "../frame";
import { labelStyle, paneStyle, canvasStyle } from "./paneStyles";
import { GainControl } from "./GainControl";

// One unit's templates, sliced (zero-copy) out of a delta frame and cached.
interface WaveUnit {
  channels: number[];
  values: Float32Array; // (n_channels * n_samples)
}

function splitWaveformFrame(frame: DecodedFrame): Map<string, WaveUnit> {
  const units = (frame.header.units ?? []) as {
    id: string | number; channels: number[]; n_channels: number; offset: number;
  }[];
  const ns = (frame.header.n_samples as number) ?? 0;
  const values = frame.buffers.values as Float32Array;
  const out = new Map<string, WaveUnit>();
  for (const u of units) {
    out.set(String(u.id), {
      channels: u.channels,
      values: values.subarray(u.offset, u.offset + u.n_channels * ns),
    });
  }
  return out;
}

export function WaveformPane(
  { sock, meta, visibleUnits }: { sock: Sock; meta: Meta; visibleUnits: UnitId[] },
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cvRef = useRef<CachedUnitView<WaveUnit> | null>(null);
  const viewRef = useRef<WaveformView | null>(null);
  const [gain, setGain] = useState(1);

  useEffect(() => {
    const view = new WaveformView(canvasRef.current!, setGain);
    viewRef.current = view;
    cvRef.current = new CachedUnitView<WaveUnit>(
      sock,
      "waveform_frame",
      (missing) => ({ type: "waveform_request", unit_ids: missing }),
      splitWaveformFrame,
      (visible, lastFrame) => {
        const ns = (lastFrame?.header.n_samples as number) ?? meta.n_template_samples;
        const data = visible.map(({ unit, value }) => {
          const c = meta.unit_colors[String(unit)] ?? [150, 150, 150, 255];
          return { channels: value.channels, values: value.values, color: [c[0], c[1], c[2]] as RGB };
        });
        view.render(data, {
          locations: meta.channel_locations,
          nbefore: meta.nbefore,
          nSamples: ns,
          absMax: meta.template_abs_max,
        });
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    cvRef.current?.setVisible(visibleUnits);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleUnits]);

  return (
    <div style={{ ...paneStyle, borderLeft: "1px solid #333" }}>
      <div style={labelStyle}>waveforms (templates on probe)</div>
      <canvas ref={canvasRef} style={canvasStyle} />
      <GainControl gain={gain} onBump={(f) => viewRef.current?.bumpGain(f)} />
    </div>
  );
}
