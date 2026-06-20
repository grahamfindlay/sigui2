# sigui2 roadmap

A living list of shipped work, in-progress features, and ideas worth considering.
Not a commitment — a place to capture intent so it isn't lost. Keep it current as
things land or get reprioritized.

Status legend: ✅ shipped · 🚧 in progress · 🔭 planned/idea · ⏸ parked

Disposition tags (used in the parity section below — the goal is a *better* app,
not a clone): `[parity]` clone roughly as-is (already good) · `[enhance]` parity
target with a better design than sigui's · `[replace]` do the *goal* a different
way (sigui's mechanism is weak) · `[drop]` recommend **not** building it (reason
given) · `[foundation]` shared infrastructure that unblocks many entries.
Effort hints: (S) small · (M) medium · (L) large. `⚠ confirm` = the rationale
rests on a workflow/scientific assumption the user should confirm.

---

## Shipped ✅

- **Server spine**: FastAPI + one headless `Controller` (`backend="web"`), pydantic
  control schema, binary frame protocol (`[u32 len][msgpack header][payload]`),
  workspace-wired package.
- **Delta protocol**: per-unit client cache + visibility mask; toggling a unit
  fetches only the missing units, toggle-off is zero network.
- **Layout**: dockview docking (resizable/floatable), panels read live state via
  React Context.
- **Views**: traces (min/max LOD), tracemap (depth×time image), amplitude scatter
  (pickable working set), 2D density (faithful full-set histogram), template
  similarity heatmap, ISI + auto-correlogram, waveform templates on probe, probe
  map, spikelist (windowed), unit-list table (TanStack, virtualized).
- **Curation**: merge / unmerge / delete / restore / label / split / unsplit /
  save (annotation model; never mutates unit_ids).
- **Selection (shared across windows)**: spike-level lasso → exact server-side
  region query → split; coordinate-based pick-highlight (single click + spikelist
  row). The selection is one shared Controller state, broadcast to all windows
  with enough to redraw it (lasso polygon; pick points + spike index), so every
  window shows the same highlight, outline, and "#N" readout. Clear resets the
  shared selection everywhere (also fixes a single-window clear→split staleness).
- **Multi-window (multi-monitor) shared session**: open the same URL in a 2nd
  browser window on another monitor; an in-process client registry broadcasts
  shared state (visibility, curation, selection) to every window so they stay in
  sync. One Controller = one session; a late-joining window adopts the live
  visibility (order-insensitive echo guard prevents ping-pong). NOTE: the
  Controller caps simultaneously-visible units (~10) — the *clamped* set is
  broadcast, so the acting window reconciles too (no actor/observer divergence).
- **Free a hidden tab's WebGL context**: dockview already unmounts a hidden tab
  (`onlyWhenVisible` default); views now `dispose()` (`deck.finalize()` + clear
  FPS timers / stress rAF / gain-key + lasso listeners) on unmount, so switching
  tabs no longer leaks contexts toward the browser's ~16 cap. Cost: a hidden→shown
  tab re-inits (re-fetch + re-fit).
- **Amplitude/contrast gain** on trace/tracemap/waveform; hover +/- keys + corner
  control.
- **Per-view settings foundation (parity F1)**: declarative server-side descriptor
  catalog (`server/view_settings.py`) + one reusable gear/popover panel
  (`components/SettingsPanel.tsx`); `set_view_setting` round-trip with
  validate/clamp + shared-session broadcast to every window; `scope` decides
  client-redraw vs server-refetch. Proven on the amplitude scatter (point size +
  max spikes/unit). Other views get settings by adding catalog entries.
- **Global settings foundation (parity F2, `max_visible_units`)**: a flat global
  catalog (`MAIN_SETTINGS` in `server/view_settings.py`, sharing F1's `_coerce`
  validation) + a top-bar `MainSettings` gear (reuses F1's `Control` renderer) +
  a `set_main_setting` round-trip. `max_visible_units` replaces the hardcoded
  visible-unit cap; the value lives in `controller.main_settings` (the Controller
  already enforces it in `set_visible_unit_ids`), so lowering it re-applies +
  trims the visible set and re-broadcasts the existing `visible_units` message to
  every window. `color_mode` + `use_times` are deferred (see F2b/F2c below).
- **Keybinding dispatcher foundation (parity F4)**: one context-aware dispatcher
  (`frontend/src/keybindings.ts`) replaces the scattered per-view `window`
  keydown listeners. A single window listener matches the pressed key against a
  registry of bindings; a binding fires only when its `context` is `"global"` or
  equals the active pane — the pane the pointer is over, reported by a `PaneFocus`
  wrapper (`data-pane=<id>`) that lifts the old per-canvas hover model into one
  shared signal. React components register via a `useKeybinding` hook (handler in
  a ref → no re-register churn / stale closures); the imperative view classes
  register through `gainControl.attachGainKeys`, so the amplitude gain `+/-` keys
  now route through the dispatcher (scoped to their pane) instead of owning
  listeners. Proven on two unit-list bindings: **Space** (make the selected units
  the visible set) and **Alt+↑/↓** (prev/next unit shown alone, over the table's
  sorted order). Pure-frontend: every binding calls an existing `SiguiContext`
  action, so cross-window sync rides the existing broadcast for free. Curation
  (C2) + quality-label (C3) hotkeys are now each "register one more binding."
  **Browser-/OS-safe combo policy** (documented in `keybindings.ts`): the app is
  a browser tab, often on macOS, so a combo the OS swallows never reaches
  `preventDefault`. Avoid Ctrl/Cmd+arrows (Mission Control / Spaces) → use
  **Alt+arrows**; avoid Ctrl/Cmd+letters (bookmark/save/reload/minimize/find) →
  prefer **bare letters** for pane-scoped actions (typing surfaces are guarded);
  Alt+letter via `e.key` is unsafe on macOS (Option composes special chars). A
  Linux/headless harness can't reproduce macOS OS-level interception, so it can
  pass on a combo that's dead on a real Mac — pick combos by the policy, not the
  harness.
- **Curation + quality-label hotkeys (parity C2/C3)**: bare-letter hotkeys on the
  units pane that fire the existing curation actions on the selected units —
  `d`/`e`/`r`/`u`/`x` (delete/merge/restore/unmerge/unsplit) and `c`/`g`/`m`/`n`
  (clear/good/MUA/noise). Each is one `useKeybinding(...)` in `UnitListView.tsx`
  gated by the same predicate as its toolbar button (a no-op exactly when the
  button is disabled); labels bind to whichever category carries the default
  quality option-set (driven from `label_definitions`, not hardcoded). Pure
  frontend — rides the existing curation broadcast, so changes sync across
  windows. Browser-safe per the F4 policy (`e` for merge since bare `m` is MUA).
- **Segment navigation + time-seek (parity F3)**: a shared, session-wide
  `{seg, t0, t1}` time window — broadcast to every browser window like
  visibility/selection — surfaced as a top-bar `TimeNav` control (segment
  dropdown shown only when `num_segments>1`, a time scrollbar, a "go to time"
  box, and a `t0–t1 / segDur` readout) that drives the **trace +
  tracemap** views. The scrollbar seeks on *release* (commit on the native
  `change` event, not per drag-step `input`, so the trace jumps straight to the
  target instead of crawling); the "go to time" box jumps on Enter and its ↑/↓
  arrows page forward/back by exactly one window. The data plane was already segment-aware (`trace_viewport`/
  `tracemap_request` carry `seg`); F3 adds the missing pieces: `num_segments` +
  per-segment `seg_durations` + the current `time_window` in the metadata
  handshake, a `set_time_window` control message the server clamps (seg into
  range, t0/t1 into that segment's `[0, duration]`) and re-broadcasts as
  `time_window`, and a shared `timeWindow` in `SiguiContext`. **Two-way bound:**
  the toolbar writes the window AND each view's own deck.gl pan/zoom writes it
  back, so the scrollbar handle, the tracemap, and other windows all track a
  mouse drag. Reuses the visibility echo-guard pattern (a `lastSentWindow` key,
  pre-seeded on every inbound broadcast) plus a per-view self-echo skip (a view
  ignores the server's echo of the window it already shows, so an active drag is
  never fought) — so the round-trip converges in one hop with no oscillation.
  Switching segment refits the trace/tracemap to the new segment; a seek
  preserves the current window WIDTH (an explicit window-size box is **T1**).
  Stays sample-derived seconds (`sample/fs`), not the F2c real-time API.
- **Self-driven UX harness** (`frontend/uxtest/snap.mjs`): drives the running app
  with the system Chrome via `playwright-core` (no bundled-browser download) —
  load, wait, scripted click/drag/keyboard, screenshot, console/error capture,
  `page.evaluate` introspection. Lets UI changes be verified headlessly without a
  human. WebGL runs on SwiftShader (software): visuals faithful, **fps not
  meaningful**; real-GPU perf + true multi-monitor still need a human for final
  sign-off. Companion scripts cover the multi-window features headlessly:
  `multiwin.mjs` (visibility broadcast + clamp reconcile), `selsync.mjs` (shared
  lasso highlight/outline + cross-window clear), `picksync.mjs` (shared pick
  readout), `settings.mjs` (per-view settings panel round-trip + cross-window
  sync), `mainsettings.mjs` (global settings panel: max_visible_units trims the
  visible set + syncs across windows), `keybindings.mjs` (F4 dispatcher: gain
  keys context-scoped to the hovered pane + Space/Alt-arrow unit nav, synced
  across windows), `curationkeys.mjs` (C2/C3 hotkeys: d/e/r/u merge·delete·
  restore·unmerge + c/g/m labels, units-pane-scoped, synced across windows),
  `segtime.mjs` (F3 segment nav + time-seek: dropdown presence by num_segments,
  scrollbar/segment-switch seeks the trace, window B follows, tracemap follows;
  run against `--synthetic-segments 3`), and `snap.mjs tabcycle` (no
  WebGL-context leak across tab switches).

## Next up 🚧

- **State preservation across tab hide/show** — remember view-state (pan/zoom,
  gain) + last data so re-showing an `onlyWhenVisible` tab doesn't re-fetch /
  re-fit. The natural follow-on to the context-freeing work.

## Feature parity with spikeinterface-gui 🎯

The original `spikeinterface-gui` (desktop Qt + web Panel) has ~20 distinct
views plus a per-view settings system and ~14 keybindings; sigui2 ships 11 views
and only gain hover-keys. This section catalogs the gap and, per the "better app
not a clone" mandate, gives each item a disposition (see the tag legend up top).
Evidence: sigui2's `server/schema.py` `ControlMessage` union (no `*_settings`
message; `correlogram_request` returns only the ACG diagonal) and the
`frontend/src/*View.ts` view classes. Ordering is **foundations-first** (deps
dominate); see the order subsection at the end.

### Group F — Foundations (build first; unblock the rest)

- **F1 · Per-view settings protocol + reusable panel** ✅ **mechanism shipped**
  `[foundation][enhance]` (L). sigui exposes a pyqtgraph `ParameterTree` per view;
  sigui2 had none (only gain). Built: a declarative server-side descriptor
  catalog (`server/view_settings.py`: `{name,type,value,limits,step,scope}`) +
  ONE reusable gear/popover panel (`components/SettingsPanel.tsx`). A change
  round-trips via a `set_view_setting` message; the server validates/clamps,
  stores it in shared session state, and broadcasts the cleaned per-view dict to
  every window (no echo-guard needed — nothing re-sends on adopt). The descriptor
  `scope` drives the reaction: `client` re-draws, `server` re-fetches. Proven on
  the amplitude scatter (`scatter_size` client redraw + `max_spikes_per_unit`
  server re-fetch). **Remaining (later phases):** populate the other views'
  settings — each is now just more catalog entries, no plumbing. Widest
  dependency — almost every entry below needs it (bins, percentiles, colormaps,
  caps, modes).
- **F2 · Global settings** ✅ **panel + `max_visible_units` shipped**
  `[foundation][parity]` (M). A top-bar `MainSettings` gear (rides F1's `Control`
  renderer + a `set_main_setting` round-trip) now exposes `max_visible_units`,
  replacing the hardcoded ~10 cap — the value lives in `controller.main_settings`
  (already the enforcer), so lowering it trims + re-broadcasts the visible set to
  every window. **Deferred:**
  - **F2b · `color_mode`** (by_unit / only_visible / by_visibility): needs a live
    `unit_colors` rebroadcast, swapping ~5 metadata-driven views off static
    `meta.unit_colors`, a scatter refetch (colors are baked into its frame), and
    recomputing colors on visibility change for the two visibility-dependent modes
    (matching upstream `refresh_colors`).
  - **F2c · `use_times`** (real recording times vs sample-derived seconds —
    valuable for 48 h recordings): route every time-producing builder
    (scatter/trace/tracemap/spikelist) through the Controller's time API
    (`sample_index_to_time` / `get_times_chunk`), and **measure** whole-spike-train
    conversion cost on a real long recording before claiming it's free. Both ride
    the shipped MainSettings panel — each is "add a descriptor + its server
    reaction."
- **F3 · Segment navigation + time-seek** ✅ **shipped** `[foundation][parity]`
  (M). A shared session-wide `{seg,t0,t1}` window, broadcast to every window like
  visibility, surfaced as a top-bar `TimeNav` (segment dropdown when
  `num_segments>1` + time scrollbar + window-start box + readout) driving the
  trace + tracemap views. Two-way bound (toolbar AND each view's pan/zoom write
  the window; reuses the visibility echo-guard + a per-view self-echo skip so an
  active drag is never fought). Server clamps `set_time_window` to the segment's
  `[0,duration]`; metadata now carries `num_segments`/`seg_durations`/
  `time_window`. A seek preserves the current window WIDTH — the explicit
  window-size box (T1) and the slider/scrollbar/auto-scale polish (T3) now just
  ride this shared window. Still unblocks S4 (spike-rate) + S6 (event).
- **F4 · Keybinding dispatcher** ✅ **dispatcher + gain migration shipped**
  `[foundation][enhance]` (M). One context-aware dispatcher
  (`frontend/src/keybindings.ts`) replaced the scattered `window` listeners: a
  single window keydown listener matches against a binding registry, firing a
  binding only when its `context` is `"global"` or the active pane (set by the
  pointer-over pane via a `PaneFocus` `data-pane` wrapper). The amplitude gain
  `+/-` keys were migrated onto it (scoped to their pane), and a `useKeybinding`
  hook lets React panes register. Proven on **Space** (visible = selected) and
  **Alt+↑/↓** (prev/next unit shown alone; Alt not Ctrl — Ctrl+arrows are macOS
  Mission Control). See the browser-/OS-safe combo policy in the Shipped F4 bullet
  + `keybindings.ts`. **Remaining (Group C):** the curation and label hotkeys —
  each is now just one `useKeybinding(...)` against an action that already exists
  in `UnitListView.tsx`.

### Group C — Curation completeness

- **C1 · Dedicated curation view (removed / merges / splits tables)** `[enhance]`
  (M). Actions exist; the review/undo surface doesn't (only unit-table badges).
  Compact 3-section panel; rows clickable to select + navigate the involved
  units (better than Qt's static tables).
- **C2 · Curation keybindings** ✅ **shipped** `[parity]` (S): `d` delete · `e`
  merge · `r` restore · `u` unmerge · `x` unsplit, scoped to the units pane, each
  gated by the same predicate as its toolbar button (`UnitListView.tsx`). Bare
  letters per the F4 policy (NOT upstream's browser-reserved Ctrl+D/M/R/U/X); `e`
  for merge since bare `m` is the C3 MUA label. (Space + Alt+↑/↓ shipped with F4;
  `split` stays mouse-driven — it acts on the lasso region, not the row set.)
- **C3 · Quality-label hotkeys c/g/m/n** ✅ **shipped** `[parity][enhance]` (S):
  `c` clear · `g` good · `m` MUA · `n` noise on the selected units. Driven from
  `label_definitions` (binds to whichever category's options are the default
  quality set, not the hardcoded name "quality"); inert when no such category
  exists.
- **C4 · Focus mode** `[parity]` (S): hide chrome to maximize plot area. Cheap;
  low priority. Upstream uses Ctrl+F, but that is browser Find (Cmd+F on macOS) —
  pick a browser-safe key per the F4 policy (e.g. bare `f` to toggle, `Esc` to
  exit), NOT Ctrl/Cmd+F.
- **C5 · Auto-merge suggestions (MergeView)** `[enhance]` (L): runs
  `compute_auto_merge` presets and proposes merges. Useful but compute-heavy and
  a leaf — order last. Enhance: async with progress; proposals as an
  accept/reject queue.

### Group S — Spike-feature views

- **S1 · Spike depth-over-time + S2 · amplitude-scalings** `[parity]` (S
  together). In sigui these are `BaseScatterView` siblings of the amplitude
  scatter. **DRY win:** generalize sigui2's existing scatter to a `y-source`
  param (amplitude | depth | amp_scaling) → three views from one generalization.
- **S3 · Quality-metrics view** `[replace]` (M). sigui's fixed N×N
  upper-triangular scatter-matrix is cramped. Replace with a flexible 2-axis
  metrics scatter (pick X/Y metric from dropdowns) + optional small-multiples;
  metrics already in metadata. High QC value.
- **S4 · Spike-rate-over-time** `[parity]` (S, needs F3): firing rate (Hz) /
  unit over time, binned (`bin_s` setting). Value: stability / drift assessment
  over long recordings (user-confirmed).
- **S5 · Main-template grid** `[parity]` (M, **lowest priority**). Compact gallery
  of per-unit templates; overlaps the geometry waveform view but kept as a fast
  visual-triage surface. Build last.
- **S6 · Event view (raster / PSTH)** `[parity]` (M, **lowest priority**). Raster /
  PSTH aligned to a stimulus-`events` extension. Kept, but build last — not on
  the critical path for the current sleep/Neuropixels + tetrode workflows.

### Group W — Waveform & similarity depth

- **W1 · Waveform flatten mode + overlap** `[parity]` (M, needs F1): channels
  stacked linearly; toggle. Good for many-channel comparison.
- **W2 · Waveform std bands** `[enhance]` (S): ±std envelope around the template;
  strong isolation-quality cue. Server has waveforms → compute std.
- **W3 · Individual sample waveforms** `[parity]` (M): overlay N raw spike
  waveforms (`num_waveforms`, `alpha`); cap count (compute policy).
- **W4 · Channel IDs / scalebars / sparse toggle** `[parity]` (S): polish, bundle
  with W1–W3 settings.
- **W5 · Waveform heatmap view** `[parity]` (M): 2D histogram of waveform
  amplitude across channels; reuses the bitmap/heatmap primitive.
- **W6 · Similarity click-to-select-pair + method + show_all** `[enhance]` (M):
  sigui2's heatmap is display-only. Click a cell → make that unit pair visible
  (merge triage); method (l1/l2/cosine); show_all toggle. High value.
- **W7 · Full N×N cross-correlograms** `[enhance]` (M): sigui2 shows only the ACG
  diagonal. CCGs are essential for merge decisions (cross-refractory). Enhance:
  lazy-render only visible pairs; reuse the histogram primitive. Strongly
  recommend.

### Group T — Trace depth

- **T1 · xsize (time-window) control** `[parity]` (S, needs F3): explicit window
  size vs viewport-only today.
- **T2 · Spike overlay on traces + double-click-to-select-spike** `[enhance]`
  (M): colored spike markers for visible units in raw-trace context;
  double-click → pick spike (reuse existing pick/broadcast). High value.
- **T3 · Time-seek slider / scrollbar / auto-scale** `[parity]` (S): folds into
  F3.
- **T4 · Tracemap colormap / alpha / show-on-selected + spike overlay** `[parity]`
  (S): settings via F1; overlay shares T2.

### Group P — Probe & N-D

- **P1 · Probe select-unit + show_channel_id + auto-zoom** `[enhance]` (M):
  sigui2 probe is read-only. Add double-click-unit-to-select (spatial browsing).
  **Replace** sigui's draggable radius-ROI channel/unit selection with simpler
  click / box-select.
- **N1 · NDScatter (PCA)** `[replace]` (L): keep the value (PCA-feature scatter
  aids split decisions); the proposal is a static choosable 2-axis PC scatter
  (PC_i vs PC_j) reusing the scatter + lasso primitives, **dropping the
  grand-tour animation**. (Subsumes the "ndscatter" idea below.) Status: user
  agnostic on the grand-tour pending more detail — revisit before building.

### Group U — Tables & persistence

- **U1 · Unit-list column show/hide + reorder** `[enhance]` (M): sigui2 columns
  are fixed. The user already flagged column control as a sigui limitation —
  doing it *better* here (chooser + drag-reorder + metric selection) is a clear
  win.
- **X1 · Settings persistence** `[enhance]` (S, needs F1): sigui writes
  `~/.config/.../settings.json`. Browser-first → persist to `localStorage`
  and/or alongside the analyzer.

### Suggested implementation order (foundations-first)

- **Phase A — Foundations:** F1 → F2 → F4 → F3 — ✅ **all shipped**. Settings
  first (widest dependency); global settings rode it and killed the hardcoded
  cap; keybindings and segment-nav each unblock a whole group. Phase B is now
  unblocked.
- **Phase B — High-reuse, high-payoff:** S1+S2 (one scatter generalization →
  three views), W7 cross-correlograms + W6 similarity click-select (the
  merge-decision toolkit), C1 (curation review view; C2+C3 hotkeys already
  shipped), U1 (column chooser). Each is cheap *given Phase A* and serves daily
  curation.
- **Phase C — Waveform & trace richness:** W1–W4 (needs F1), T1–T4 (needs F3),
  W5 waveform heatmap.
- **Phase D — Analysis views & polish:** S4 spike-rate (needs F3), S3 metrics
  scatter (redesigned), P1 probe interactivity, N1 ndscatter (redesigned), X1
  persistence, C4 focus mode, C5 auto-merge (compute-heavy → last).
- **Lowest priority (kept, build last):** S5 main-template grid, S6 event view.
- **Replaced sub-mechanisms (not whole views):** the grand-tour animation in N1
  (user agnostic — revisit first) and sigui's draggable radius-ROI in P1 →
  simpler click / box-select.

Rationale: dependencies dominate the order (Phase A), then DRY/reuse and
curation-impact rank Phase B, then richness, then leaves. Effort hints let the
user reprioritize within a phase without breaking dependencies.

## Planned / ideas 🔭

- **Density as a scatter underlay / LOD-switch** — fold the density image under
  the amplitude scatter and auto-switch points↔density by zoom / point budget,
  instead of a separate tab.
- **Lasso on the density tab** `[parity]` — region-select is coordinate-based +
  server-exact, so it works on density for free; a more honest curation surface
  for high-rate units. (Just needs the lasso overlay wired into the density view.)
- **"Apply & continue"** — apply the current curation into a fresh in-memory
  analyzer and keep curating. Unlocks **split-then-merge** (merging a split half),
  which the annotation model can't express in one pass (see
  `developer_notes/curation_model.md`).
- **ndscatter** — n-dimensional / PCA-feature scatter (reuses the scatter +
  density primitives). See **N1** in the parity section for the redesign
  (static 2-axis PC scatter, no grand-tour animation).
- **Spikelist niceties** — column sort, jump-to-selected, filter to selected
  units.
- **Persist/restore layouts** — serialize the dockview layout (incl. popouts) so a
  session reopens where you left off.
- **Density performance for huge spike counts** — `histogram2d` is O(N) per
  viewport; if it bottlenecks on tens of millions of spikes, cache a coarse global
  histogram that fine viewports re-bin from. Measure first (workspace policy).
- **Real-data validation** — exercise the full app on a production
  `analyzer_clustered.zarr` over NFS; mark such tests `requires_nfs`.
- **Delivery** — `sigui2 <analyzer_path>` polish, optional Tauri/pywebview desktop
  wrapper (same frontend), optional anywidget notebook export.

## Parked ⏸

- **Independent per-window views** — explicitly **not planned** (user, 2026-06-18).
  The shared-session model (one Controller, all windows kept in sync) is the
  intended design; do not re-propose per-connection/independent visibility or
  selection.
- **dockview popout** (explored, then **reverted** at user request — did not want
  a half-working feature in the tree; commit `b9f52a3` removed). Render + zoom +
  sync across windows worked, but interaction (pan / gain / lasso) inside a
  popped-out window did not: deck.gl's drag + our keyboard/lasso listeners bind to
  the originating window's document, which the popped-out canvas no longer lives
  in. A recreate-on-move pass regressed it (the rebuilt deck bound to the wrong
  document — keyboard reached it but wheel/drag didn't). Fragile cross-document
  WebGL event work, hard to validate without the second monitor. **Superseded by
  independent windows + broadcast**, which sidesteps cross-document canvases
  entirely. Revisit only if in-layout popout (vs. separate windows) is specifically
  wanted.
