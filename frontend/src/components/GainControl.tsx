// Corner amplitude-gain control (discoverable, mouse-accessible companion to the
// +/- hover keys). Shows the current gain and steps it by ×1.3.
const btn: React.CSSProperties = {
  fontSize: 12, lineHeight: "14px", width: 18, height: 18, padding: 0, cursor: "pointer",
  background: "#2a3340", color: "#cde", border: "1px solid #3a4654", borderRadius: 3,
};

export function GainControl({ gain, onBump }: { gain: number; onBump: (factor: number) => void }) {
  return (
    <div title="amplitude gain (+/- when hovering)"
      style={{ position: "absolute", bottom: 6, right: 8, zIndex: 2, display: "flex",
        gap: 4, alignItems: "center", fontSize: 10, color: "#9ab", userSelect: "none" }}>
      <button style={btn} onClick={() => onBump(1 / 1.3)}>−</button>
      <span style={{ minWidth: 36, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
        {gain >= 10 ? gain.toFixed(0) : gain.toFixed(2)}×
      </span>
      <button style={btn} onClick={() => onBump(1.3)}>+</button>
    </div>
  );
}
