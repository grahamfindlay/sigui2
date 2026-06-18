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
- **Selection**: spike-level lasso → exact server-side region query → split;
  shared coordinate-based pick-highlight (single click + spikelist row).
- **Amplitude/contrast gain** on trace/tracemap/waveform; hover +/- keys + corner
  control.

## Next up 🚧

- **Free a panel's deck context when its dockview tab is hidden** — `renderer:
  'onlyWhenVisible'` on deck panels + `dispose()` on view unmount, so inactive
  tabs don't hold a live WebGL context (browsers cap ~16). Cost: a hidden→shown
  tab re-inits (re-fetch + re-fit).
- **Multi-monitor via independent windows + broadcast** — open a 2nd full browser
  window (native deck.gl canvases, all interactions work) on another monitor; the
  server broadcasts shared state (visibility, curation, selection) to all
  connected windows so they stay in sync. One coherent session across monitors.
  (This is the chosen multi-monitor path — see Parked: popout.)
- **Self-driven UX testing harness** — headless Chromium (Playwright) on the
  server to launch/interact/screenshot client sessions, so UI changes can be
  verified without a human in the loop (software WebGL: correctness yes, fps no).

## Planned / ideas 🔭

- **State preservation across tab hide/show** — remember view-state (pan/zoom,
  gain) and last data so re-showing an `onlyWhenVisible` tab doesn't re-fetch /
  re-fit. Pairs with the context-freeing work.
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
- **Independent per-window views** — let different windows show different visible
  units (needs the spikelist + split paths to take explicit unit sets instead of
  the shared Controller visibility).
- **Density performance for huge spike counts** — `histogram2d` is O(N) per
  viewport; if it bottlenecks on tens of millions of spikes, cache a coarse global
  histogram that fine viewports re-bin from. Measure first (workspace policy).
- **Real-data validation** — exercise the full app on a production
  `analyzer_clustered.zarr` over NFS; mark such tests `requires_nfs`.
- **Delivery** — `sigui2 <analyzer_path>` polish, optional Tauri/pywebview desktop
  wrapper (same frontend), optional anywidget notebook export.

## Parked ⏸

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
