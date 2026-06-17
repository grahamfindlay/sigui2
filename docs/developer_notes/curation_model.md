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
(category/label; label=null clears), `save_curation`. Client unit ids are mapped
back to the Controller's own id objects by `str()` (`Session.to_unit_ids`).

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

## Deferred: split

`make_manual_split_if_possible` needs a **spike-level selection** (which spikes of
the unit form the split), i.e. lasso/box selection on the scatter. sigui2 has no
spike selection UI yet, so split is deferred.
