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
  across windows), and `snap.mjs tabcycle` (no WebGL-context leak across tab
  switches).

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
- **F3 · Segment navigation + time-seek** `[foundation][parity]` (M). sigui2's
  `trace_viewport` has a `seg` arg but no UI; sigui has segment dropdown + time
  slider + scrollbar. Shared segment+time control. Unblocks trace depth,
  spike-rate, event.
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
- **C2 · Curation keybindings** `[parity]` (S, **F4 ready**): delete, merge,
  restore, unmerge, unsplit. (Space + Alt+↑/↓ already shipped with F4.) Each is
  one `useKeybinding(...)` over the existing `UnitListView.tsx` action, gated
  `when: () => curation`. **Do NOT copy upstream's Ctrl+D/M/R/U/X** — Ctrl/Cmd +
  letter is browser/OS reserved (Cmd+D bookmark, Cmd+R reload, Cmd+M minimize,
  Cmd+X cut). Choose browser-safe combos at build time per the F4 policy: prefer
  bare letters, but note bare `m` collides with the C3 MUA label, so the curation
  actions need distinct letters (or an `e.code`-based modifier combo).
- **C3 · Quality-label hotkeys c/g/m/n** `[parity]` (S, **F4 ready**): clear /
  good / mua / noise on selected units. Enhance: drive from `label_definitions`,
  not hardcoded to "quality".
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

- **Phase A — Foundations:** F1 → F2 → F4 → F3. Settings first (widest
  dependency); global settings ride it and kill the hardcoded cap; keybindings
  and segment-nav each unblock a whole group.
- **Phase B — High-reuse, high-payoff:** S1+S2 (one scatter generalization →
  three views), W7 cross-correlograms + W6 similarity click-select (the
  merge-decision toolkit), C1+C2+C3 (curation view + hotkeys — browser-safe
  combos per the F4 policy, not upstream's Ctrl+letter/Ctrl+arrow), U1 (column
  chooser). Each is cheap *given Phase A* and serves daily curation.
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
