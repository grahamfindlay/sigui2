---
title: sigui2 frontend deck.gl / React gotchas
scope: sigui2
status: active
source: measurement
created: 2026-06-16
last_updated: 2026-06-16
confidence: high
confirmed_by_user: not_required
---

# Frontend deck.gl / React gotchas

Hard-won lessons from the Phase-2a React shell + deck.gl views. Apply these when
adding the remaining views.

## Fit must use the canvas CSS size, not `deck.width`/`deck.height`

`deck.width`/`deck.height` are `0`/undefined until deck.gl measures the canvas on
its first animation frame. A view created in a React `useEffect` and fit
immediately reads the fallback (we used 800x300), so the data is fit into a small
sub-region of a large canvas — symptoms were "traces don't fill the width" and
the stress cloud rendering as a small centered square on a 4K display.

Fix: read `canvas.clientWidth`/`canvas.clientHeight` (store the canvas on the view
class). These reflect the committed CSS layout immediately inside `useEffect`
(reading them forces sync layout) and are in CSS pixels, which is the right unit
for the orthographic fit regardless of `useDevicePixels`.

## Re-render with shrinking data: version the layer id

deck.gl reuses GPU buffers across updates of a same-id layer. When the point
count shrinks (e.g. deselecting units), reused buffers leave stale points and a
mismatched color buffer ("many units, wrong colors"). Use a fresh layer id per
update (`spikes-${++version}`) so deck.gl recreates buffers. Cheap at our update
cadence (on interaction, not per frame).

## Fit once, not every update

Setting `initialViewState` on every `render()` resets the user's pan/zoom. Fit
only on the first render (a `fitted` flag); later updates pass only `layers`.

## useDevicePixels on large/HiDPI displays

`useDevicePixels: true` (default-ish) renders at full device pixels; on a 4K
HiDPI display that is a ~4x larger framebuffer. We currently use full HiDPI
(`true`) because pixels were NOT the bottleneck (dropping to 1x barely changed
fps); the bad fit above was. If a future dense view is genuinely fill/composite
bound on big displays, `useDevicePixels: 1.5` is a good sharpness/cost
compromise.

## ScatterplotLayer perf

`antialiasing: false` is essential for dense scatter (it was the difference
between 15 and 60 fps at 2M points). `pickingRadius: ~8` on the Deck is needed or
~1px points are unclickable. Pass geometry/colors as binary attributes
(`{value, size}`); colors as Uint8 size-4 are interpreted as 0-255.

## Shared socket: route frames by header type

Trace and scatter share one `Sock`. A single FIFO of reply resolvers can
cross-feed them; route binary frames to per-`header.type` queues instead
(`requestFrame(msg, "trace_frame" | "scatter_frame")`).

## Heatmap (BitmapLayer): nearest-neighbour sampling

A small value matrix (e.g. 20x20 similarity) drawn with `BitmapLayer` is upscaled
with linear filtering by default → blurry. Set
`textureParameters: {minFilter: "nearest", magFilter: "nearest"}` for crisp cells.

## Histograms: flipY orientation + filled step polygons

`OrthographicView` defaults to `flipY: true` (world +y points DOWN on screen). For
a per-row histogram, put the baseline at the BOTTOM of the row band (`u + 0.9`)
and make bars rise toward smaller y; baseline-at-`u` draws them hanging downward
(looks inverted). Draw each unit's histogram as ONE filled "step" polygon via
`SolidPolygonLayer` (no inter-bar gaps) rather than thin `LineLayer` bars (which
render as sparse slivers with big gaps).

## Stress mode is a GPU benchmark only

`/?stress=N` renders N synthetic points and ignores sidebar selections by design.
Do not interpret its behavior as real-data behavior (this caused a false "color
bug" report).

## Delta protocol: per-unit client cache + visibility mask

Every per-unit view (amplitude scatter, ISI, ACG) decomposes into one independent
contribution per unit. Toggling a unit must not re-fetch units already seen, and
toggling a unit OFF must do zero network I/O. `unitCache.ts`'s `CachedUnitView<T>`
implements this: cache each unit's payload keyed by id, request only the *missing*
units, split the delta frame back into per-unit pieces, and re-assemble the
currently-visible set from cache (a local typed-array concat) on every change.

Two non-obvious requirements make this correct:

- **Server payload must be per-unit deterministic.** A unit's bytes must be
  identical whether it is fetched alone or batched. `lod/scatter.build_working_set`
  used to apportion `max_per_unit` down by the co-visible total (to honour a
  global cap); that made a unit's sample depend on its batch and is incompatible
  with caching. It was removed (fixed per-unit budget); the zoomed-out
  "everything" case is the future density-overview layer's job, not the working
  set. Guarded by `test_scatter_per_unit_determinism`.
- **Split frames using header metadata, not buffer order.** Scatter uses
  `header.ranges[unit] = [lo, hi)`; histograms use `header.unit_ids` (row-major
  `counts`). Slice with typed-array `.subarray()` — those are zero-copy *views*
  onto the frame's ArrayBuffer, so caching a unit costs no copy and keeps the
  buffer alive. Assemble in the client's *current* visible order (iterate
  `visible`, look up cache), not frame order, so render order is stable.
- **Render against the latest visibility, always.** `setVisible` stores `visible`
  on the instance and reads it after any awaited fetch, so a fetch whose units
  were toggled away mid-flight renders harmlessly against the current set.
- `set_visible_units` is now sent once from `App` on any change (it keeps the
  server Controller's visibility in sync for selection/curation) and is OFF the
  data hot path — views fetch their own deltas with explicit `unit_ids`.

## dockview: panels read state via React Context, not addPanel params

dockview panels are mounted imperatively (`api.addPanel`), so they do NOT receive
updated props when App state changes. But dockview renders each panel through a
React portal that is still in the React tree, so **Context propagates into
panels**. `SiguiContext` carries `{sock, meta, visibleUnits, setVisibleUnits}`;
each panel wrapper in `panels.tsx` pulls from `useSigui()`. addPanel `params`
would be a frozen snapshot — don't use them for live state.

- The `components` map must have **stable identity** (defined once at module
  scope), or dockview warns/re-mounts. The App's `ctx` object is rebuilt via
  `useMemo` on state change; that's what pushes fresh state through context.
- `buildDefaultLayout` is **idempotent-guarded** (`if (api.panels.length) return`)
  so a re-fired `onReady` can't throw on duplicate panel ids.
- Panes must fill the panel body: `paneStyle` carries `width/height: 100%`
  (panels are sized by dockview now, not CSS-grid tracks). The absolute canvas
  then fills the pane.
- **The async data fetch saves us from the 0-size-fit bug**: each view fits once
  on its first *data frame*, which arrives after a WS round-trip — by then the
  panel has its real layout size, so `canvas.clientWidth` is correct. (Fitting
  synchronously on mount would race dockview's layout pass.)
- Theme: import `dockview/dist/styles/dockview.css` (vite extracts it to a dist
  CSS file) and set `className="dockview-theme-abyss"` on `<DockviewReact>`.

## TanStack virtualized table (unit list)

The unit list (`UnitTable.tsx`) uses `@tanstack/react-table` for sort state +
sorted row model and `@tanstack/react-virtual` for row virtualization (scales to
100-500 units).

- **Layout via a shared CSS grid template**, not a `<table>`: the sticky header
  row and every body row use the same `gridTemplateColumns` string so columns
  line up. Header is `position: sticky; top: 0`; the body is a `position:
  relative` box of height `getTotalSize()` with each virtual row
  `position: absolute; transform: translateY(virtualItem.start)`.
- **Null metrics**: accessor returns `value ?? undefined` (not `null`) and the
  column sets `sortUndefined: "last"`, so missing metrics sort to the bottom; the
  cell still renders from `row.original` (displays "–").
- **Numeric id sort**: ids like `"0".."19"` would sort lexically ("10" < "2");
  the `unit` accessor coerces to `Number(id)` when finite.
- Server side: `metric_columns` + `unit_metrics` come from
  `Controller.get_units_table()` (spikeinterface `make_units_table_from_analyzer`),
  always augmented with `num_spikes`/`firing_rate` so the table is useful even on
  analyzers without a quality-metrics extension (the synthetic one only has x/y).

## Waveform view: geometry-positioned templates + amplitude gain

`waveformView.ts` draws each unit's average template at probe geometry — every
channel's template is a short polyline anchored at the channel `(x, y)`, all
units overlaid (deck.gl `LineLayer`, binary attributes, same hot path as traces).
Per-unit and delta-cached like the scatter view (server `build_waveform_frame`
sends each unit's sparse-channel templates with per-unit channel lists + float
offsets in one flat buffer).

- **Scale to the contact pitch**: compute the median nearest-neighbour channel
  distance once; waveform width ≈ 0.7·pitch, default height ≈ 0.8·pitch·gain /
  global-|template|-max. Scaling to a *global* amplitude max keeps units
  comparable but flattens small-amplitude units — hence the gain control.
- **flipY orientation**: world +y is down, and templates are drawn `cy - val·ys`
  so troughs (negative) deflect downward (conventional).
- **Tetrode caveat**: degenerate geometry (near-co-located contacts) makes
  templates overlap; fine for NP-like probes, needs a spread fallback for real
  tetrodes.

## Amplitude gain: hover-targeted +/- (wheel is taken by zoom)

`gainControl.ts::attachGainKeys(canvas, bump)` adds a vertical gain to the
amplitude views. The mouse wheel is pan/zoom, so `+`/`-`/`=` adjust the gain of
whichever canvas the pointer is **hovering** (pointerenter/leave flag + a window
keydown listener that no-ops unless hovered — so it never fights text inputs).
`components/GainControl.tsx` is the discoverable corner `− 1.30× +` companion.

Pattern for "redraw on a control change without new data": cache the last render
inputs on the view (`lastFrame` for traces; `units`/`geom` for waveforms) and
have `bumpGain` recompute from them. The view reports the new gain back through an
`onGain` callback so the React corner readout stays in sync with the keys.

## Lasso / region select: a DOM overlay, NOT deck's controller toggle

To drag a freehand lasso on the scatter you must stop deck from panning. The
**wrong** way is `deck.setProps({controller: false})` on lasso-enter: in practice
it did not reliably disable pan/zoom, and it cannot change the cursor anyway —
deck.gl manages the canvas cursor itself (it re-asserts `grab`/`grabbing` every
render), so an inline `canvas.style.cursor = "crosshair"` gets overwritten.

The robust pattern (standard for deck.gl custom drag tools) is a transparent
**capture overlay** `<div>` over the canvas (`ScatterPane` renders it,
`ScatterView` drives it):

- Default `pointer-events: none` → pan/zoom + click-pick pass straight through to
  the canvas. `setLassoMode(true)` flips it to `pointer-events: auto`, so the
  overlay swallows every pointer event (deck's controller never sees them) and the
  overlay's own `cursor: crosshair` shows. No deck controller toggling at all.
- z-index: overlay at `1` (above the canvas), the corner lasso/clear control at
  `2` (above the overlay, so it stays clickable while lassoing).
- Lasso geometry: capture pointer path in client pixels, `unproject` each point
  via `deck.getViewports()[0]` to **world coords** (here `x=time_s, y=amplitude`,
  the same space as the scatter data), feed a `PolygonLayer` for the live outline.
  Attach `pointermove`/`pointerup` to `window` (not the overlay) so a drag that
  leaves the pane still tracks and finishes.
- Immediate feedback vs authority: the view runs a **local** even-odd
  point-in-polygon over its *rendered* (decimated) points to highlight instantly
  (white overlay scatter), and in parallel hands the world polygon to the server
  (`select_region`) for the **exact** selection over the full spike set. The
  server count (not the local sample count) is what drives the split. The view
  clears its highlight on any re-render (visibility change ⇒ stale selection); an
  external clear (toolbar/post-split) flows through a `selectionNonce` the pane
  watches, since the toolbar can't call the view directly.
