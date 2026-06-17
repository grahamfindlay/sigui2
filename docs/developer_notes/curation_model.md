---
title: sigui2 curation model
scope: sigui2
status: active
source: code_inspection
created: 2026-06-17
last_updated: 2026-06-17
confidence: high
confirmed_by_user: not_required
---

# Curation model

sigui2 reuses `spikeinterface_gui.controller.Controller`'s curation data model
(SI Curation format v2). Enabled via `Controller(..., curation=True)` in
`Session`.

## Key property: curation is annotation-only

Manual curation **never changes `unit_ids`**. Merges, splits, removals, and
labels are recorded in `controller.curation_data` and applied only at export
(`construct_final_curation` / when the curation is applied to a sorting). Two
consequences:

- The deck.gl per-unit caches (scatter/ISI/ACG) stay valid across curation — a
  merged or removed unit still has the same id and data. No cache invalidation
  is needed for v1.
- "Deleted" (removed) units still plot. They are only excluded from the final
  curated output, not hidden. (The user confirmed 2026-06-17 they prefer this
  "stays plotted" behavior; the table marks them dim + strikethrough so they
  remain inspectable and restorable.)

## Mutual exclusivity (a hard rule in the model)

Per unit, **merge / remove / split are mutually exclusive**. You cannot delete a
unit that is in a merge group, etc. (`make_manual_delete_if_possible` skips units
that are merged/split/already-removed; selecting a mix deletes only the eligible
ones). To delete a merged unit, unmerge it first. This is intended SI behavior,
not a sigui2 limitation.

## Wire protocol

Control messages (client → server) mutate the Controller; the server echoes the
full `curation` state after every mutation so the client re-syncs even on no-ops:
`merge_units`, `unmerge_units`, `delete_units`, `restore_units`, `label_units`
(category/label; label=null clears), `split_units`, `unsplit_units`,
`save_curation`. Client unit ids are mapped back to the Controller's own id
objects by `str()` (`Session.to_unit_ids`).

`select_region` is the one curation-adjacent message that does **not** echo
`curation`: it sets the server spike selection from a lasso polygon and echoes a
`selection` summary instead (see "Split via region selection").

The `curation` state = `{label_definitions, merges, removed, splits, labels,
can_save, saved}`. It is also embedded in the initial `metadata`. `can_save` is
`analyzer.format != "memory"` — the `--synthetic` CLI uses the **cached zarr**
analyzer, so save works and **persists into `~/.cache/sigui2/synthetic.zarr`**
across restarts (delete that dir for a clean slate).

## Unmerge: dissolve-when-needed policy

`server/app.py::_unmerge` is a higher-level policy over two Controller primitives.
`remove_units_from_merge_if_possible` only removes units if **≥2 would remain**
(a merge needs ≥2 members), else no-op. So sigui2's single "unmerge" button: for
each touched group, partial-remove if ≥2 remain, otherwise **dissolve the whole
group** via `make_manual_restore_merge`. This is a sigui2 UX choice — the upstream
primitive is correct and unchanged (see the workspace memory
`project_sigui_unmerge_upstream`).

## Split via region selection

`make_manual_split_if_possible(unit_id)` reads the Controller's **global spike
selection** and requires every selected spike to belong to `unit_id`, then records
`{"unit_id", "mode": "indices", "indices": [[within-unit indices]]}` — a 2-way
split (selected spikes vs the rest). sigui2 drives it from a **lasso** on the
amplitude scatter:

1. `select_region` carries the lasso polygon in scatter world coords
   (`[x=time_s, y=amplitude]`). The server hit-tests the **full** per-spike arrays
   of the visible units (`lod/scatter.points_in_polygon`, vectorized even-odd) —
   exact, not the decimated working set the client renders — and calls
   `set_indices_spike_selected`. It echoes `{type:"selection", n, per_unit}`
   (counts only; the client highlights its own rendered points locally, so the
   index list never goes back over the wire).
2. `split_units` splits **every unit the selection covers**: it groups the global
   selection by `spikes["unit_index"]` and, for each unit, sets the selection to
   that unit's subset and calls `make_manual_split_if_possible`, restoring the
   full selection afterward (`app.py::_split`). Optional `unit_ids` restricts it.
3. `unsplit_units` removes a unit's pending split (`make_manual_restore_split`),
   mirroring unmerge/restore.

A lassoed unit that is removed / in a merge / not visible is silently skipped by
the Controller (intended).

### You cannot merge a split *half* in the same curation pass

A split's halves have **no unit id** until the curation is applied — the split is
just sub-groups of the original unit's spikes. Merge/split are also mutually
exclusive per unit (`make_manual_merge_if_possible` refuses any unit in `splits`,
controller.py:1001-1006; `make_manual_split_if_possible` refuses any unit in a
merge). So "split unit X, then merge half of it with unit Y" is **not expressible**
in one annotation pass — in SI's curation module *or* spikeinterface-gui, since
both use this same deferred-apply model. The path would be **apply the curation**
(materializing the split halves as real new ids) → reload that analyzer → curate
again. (phy supports split-then-merge natively because it mutates a *live*
clustering with immediate new ids + undo/redo, trading away replayability.) A
future sigui2 "apply & continue" action would unlock this generally. Shelved as a
nice-to-have (user, 2026-06-17).
