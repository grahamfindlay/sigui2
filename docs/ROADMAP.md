# sigui2 roadmap

A living list of shipped work, in-progress features, and ideas worth considering.
Not a commitment — a place to capture intent so it isn't lost. Keep it current as
things land or get reprioritized.

Status legend: ✅ shipped · 🚧 in progress · 🔭 planned/idea · ⏸ parked

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
- **Self-driven UX harness** (`frontend/uxtest/snap.mjs`): drives the running app
  with the system Chrome via `playwright-core` (no bundled-browser download) —
  load, wait, scripted click/drag/keyboard, screenshot, console/error capture,
  `page.evaluate` introspection. Lets UI changes be verified headlessly without a
  human. WebGL runs on SwiftShader (software): visuals faithful, **fps not
  meaningful**; real-GPU perf + true multi-monitor still need a human for final
  sign-off. Companion scripts cover the multi-window features headlessly:
  `multiwin.mjs` (visibility broadcast + clamp reconcile), `selsync.mjs` (shared
  lasso highlight/outline + cross-window clear), `picksync.mjs` (shared pick
  readout), and `snap.mjs tabcycle` (no WebGL-context leak across tab switches).

## Next up 🚧

- **State preservation across tab hide/show** — remember view-state (pan/zoom,
  gain) + last data so re-showing an `onlyWhenVisible` tab doesn't re-fetch /
  re-fit. The natural follow-on to the context-freeing work.
## Planned / ideas 🔭

- **Density as a scatter underlay / LOD-switch** — fold the density image under
  the amplitude scatter and auto-switch points↔density by zoom / point budget,
  instead of a separate tab.
- **Lasso on the density tab** — region-select is coordinate-based + server-exact,
  so it works on density for free; a more honest curation surface for high-rate
  units. (Just needs the lasso overlay wired into the density view.)
- **"Apply & continue"** — apply the current curation into a fresh in-memory
  analyzer and keep curating. Unlocks **split-then-merge** (merging a split half),
  which the annotation model can't express in one pass (see
  `developer_notes/curation_model.md`).
- **ndscatter** — n-dimensional / PCA-feature scatter (reuses the scatter +
  density primitives).
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
