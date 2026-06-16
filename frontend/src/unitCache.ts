// Per-unit client cache + visibility-driven assembly: the "delta protocol".
//
// Every per-unit view (amplitude scatter, ISI, auto-correlogram) decomposes
// into one independent contribution per unit. Toggling a unit's visibility must
// NOT re-fetch units already seen, and toggling a unit OFF must do no network
// I/O at all. So we:
//
//   1. cache each unit's contribution keyed by unit id,
//   2. on a visibility change, request ONLY the units we are missing,
//   3. split that delta frame back into per-unit pieces and cache them,
//   4. re-assemble the *currently* visible units from cache (a local, instant
//      typed-array concat) and hand them to the renderer.
//
// This relies on a server-side invariant: a unit's payload is a pure function of
// that unit alone (see lod/scatter.build_working_set), so a cached unit stays
// valid regardless of what else is visible.
import { Sock } from "./socket";
import { DecodedFrame } from "./frame";
import { UnitId } from "./types";

export class CachedUnitView<T> {
  private cache = new Map<string, T>();
  private visible: UnitId[] = [];
  // The most recent delta frame, kept so renderers can read frame-global,
  // unit-independent fields (e.g. histogram bin edges) without re-deriving them.
  private lastFrame: DecodedFrame | null = null;

  constructor(
    private sock: Sock,
    private replyType: string,
    private buildRequest: (missing: UnitId[]) => unknown,
    private splitFrame: (frame: DecodedFrame) => Map<string, T>,
    private renderVisible: (
      visible: { unit: UnitId; value: T }[],
      lastFrame: DecodedFrame | null,
    ) => void,
  ) {}

  /** Forget a unit's cached payload (e.g. after a curation edit changed it). */
  invalidate(unit: UnitId): void {
    this.cache.delete(String(unit));
  }
  /** Forget everything (e.g. after a merge/split reshapes the unit set). */
  invalidateAll(): void {
    this.cache.clear();
    this.lastFrame = null;
  }

  /**
   * Set the visible units: fetch any not yet cached, then render from cache.
   * Toggling a unit off (no new units) takes the no-fetch path and re-renders
   * the smaller set immediately. Always renders against the latest `visible`,
   * so an in-flight fetch whose units were toggled away mid-flight is harmless.
   */
  async setVisible(units: UnitId[]): Promise<void> {
    this.visible = units;
    const missing = units.filter((u) => !this.cache.has(String(u)));
    if (missing.length > 0) {
      const frame = await this.sock.requestFrame(this.buildRequest(missing), this.replyType);
      this.lastFrame = frame;
      for (const [k, v] of this.splitFrame(frame)) this.cache.set(k, v);
    }
    this.renderFromCache();
  }

  private renderFromCache(): void {
    const visible: { unit: UnitId; value: T }[] = [];
    for (const u of this.visible) {
      const v = this.cache.get(String(u));
      if (v !== undefined) visible.push({ unit: u, value: v });
    }
    this.renderVisible(visible, this.lastFrame);
  }
}
