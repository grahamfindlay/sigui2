"""Declarative per-view settings catalog (the F1 foundation).

This is sigui2's single source of truth for which display/data parameters each
view exposes. The original ``spikeinterface-gui`` gives every view a ``_settings``
list (``{name, type, value, limits, step}``) rendered by both its Qt and Panel
backends; we mirror that *shape* so the descriptors are familiar, and add a
``scope`` field that the browser uses to decide how a change re-renders:

* ``scope="server"`` -- the setting changes what the server *computes* (e.g. the
  scatter decimation cap), so a change must re-fetch the view's data frame. The
  builders read the current value out of ``Session.view_settings`` exactly like
  they already read the shared visibility, so a re-fetch is automatic.
* ``scope="client"`` -- the setting only changes how an existing frame is *drawn*
  (e.g. point size), so a change re-renders client-side with no network round
  trip.

Settings are session state (one Controller per process, all windows mirror it),
broadcast to every window on change like curation/visibility. Persistence to
disk/localStorage is a later roadmap item (X1); here the values live in memory.

For F1 the catalog is intentionally seeded with a single proof view (the
amplitude scatter) that exercises both scopes. Later phases (W/T/S groups) add
entries for the other views -- no plumbing changes, just more descriptors.
"""

from __future__ import annotations

from typing import Any

# Each descriptor: name/type/value(default)/optional limits/step + a scope.
#   type "bool" | "int" | "float"   -> numeric/boolean; limits = (min, max)
#   type "list"                     -> choice; limits = the allowed values
VIEW_SETTINGS: dict[str, list[dict]] = {
    "scatter": [
        {
            "name": "scatter_size",
            "label": "Point size",
            "type": "float",
            "value": 1.2,
            "limits": [0.4, 8.0],
            "step": 0.2,
            "scope": "client",
        },
        {
            "name": "max_spikes_per_unit",
            "label": "Max spikes / unit",
            "type": "int",
            "value": 100_000,
            "limits": [1_000, 1_000_000],
            "step": 1_000,
            "scope": "server",
        },
    ],
}

# Application-global settings (F2): not tied to a single view. The original
# ``spikeinterface-gui`` keeps three of these in ``controller.main_settings``
# (``max_visible_units``, ``color_mode``, ``use_times``); sigui2 surfaces
# ``max_visible_units`` so far. It replaces the previously-hardcoded cap on how
# many units may be simultaneously visible. The wrapped Controller still
# *enforces* it (``set_visible_unit_ids`` truncates to it), so the value's single
# source of truth stays ``controller.main_settings`` (see ``Session``); this
# catalog only declares the descriptor + default so the panel can render and
# validate the setting, exactly like the per-view catalog above.
MAIN_SETTINGS: list[dict] = [
    {
        "name": "max_visible_units",
        "label": "Max visible units",
        "type": "int",
        "value": 10,
        # Soft, easily-tuned ceiling: each visible unit costs a per-unit fetch +
        # render and the correlogram grid is O(N^2), so this is bounded rather
        # than unlimited. Raise it here if a workflow needs more.
        "limits": [1, 50],
        "step": 1,
        "scope": "server",
    },
]


def catalog() -> dict[str, list[dict]]:
    """The descriptor lists, for the client to render the settings panel.

    A deep-ish copy so a consumer mutating a descriptor can't corrupt the
    module-level source of truth (the dicts are flat besides the ``limits`` list).
    """
    return {
        view: [{**d, "limits": list(d["limits"]) if "limits" in d else None}
               for d in descriptors]
        for view, descriptors in VIEW_SETTINGS.items()
    }


def defaults() -> dict[str, dict[str, Any]]:
    """Initial ``{view: {name: value}}`` map seeding a session's settings."""
    return {
        view: {d["name"]: d["value"] for d in descriptors}
        for view, descriptors in VIEW_SETTINGS.items()
    }


def _descriptor(view: str, name: str) -> dict:
    try:
        descriptors = VIEW_SETTINGS[view]
    except KeyError:
        raise KeyError(f"unknown settings view {view!r}") from None
    for d in descriptors:
        if d["name"] == name:
            return d
    raise KeyError(f"unknown setting {name!r} for view {view!r}")


def _coerce(d: dict, value: Any, where: str) -> Any:
    """Coerce + bound ``value`` against descriptor ``d`` (shared by view + main).

    Numeric types are coerced and clamped into ``limits``; ``list`` types must be
    one of the allowed choices; ``bool`` is coerced. Raises ``ValueError`` for an
    uncoercible / out-of-choice value. ``where`` is a human label for the error
    message (e.g. ``"scatter.scatter_size"`` or ``"max_visible_units"``).
    Returning the cleaned value (rather than trusting the client) keeps the
    session authoritative, mirroring how the Controller may adjust a requested
    visibility set.
    """
    t = d["type"]
    if t == "bool":
        return bool(value)
    if t == "list":
        choices = d["limits"]
        if value not in choices:
            raise ValueError(f"{value!r} is not a valid choice for {where}")
        return value
    if t in ("int", "float"):
        try:
            num = int(value) if t == "int" else float(value)
        except (TypeError, ValueError):
            raise ValueError(f"{value!r} is not a valid {t} for {where}") from None
        lim = d.get("limits")
        if lim is not None:
            lo, hi = lim
            num = max(lo, min(hi, num))
            num = int(num) if t == "int" else float(num)
        return num
    raise ValueError(f"unsupported setting type {t!r} for {where}")


def validate(view: str, name: str, value: Any) -> Any:
    """Coerce + bound a client-sent per-view value against its descriptor.

    Raises ``KeyError`` for an unknown view/name (see ``_descriptor``) and
    ``ValueError`` for an uncoercible / out-of-choice value (see ``_coerce``).
    """
    return _coerce(_descriptor(view, name), value, f"{view}.{name}")


# --- application-global settings (F2): the flat MAIN_SETTINGS catalog ---------


def main_catalog() -> list[dict]:
    """The global-settings descriptors, for the client to render the panel."""
    return [
        {**d, "limits": list(d["limits"]) if "limits" in d else None}
        for d in MAIN_SETTINGS
    ]


def main_defaults() -> dict[str, Any]:
    """Initial ``{name: value}`` map for the application-global settings.

    Seeds the wrapped Controller's ``main_settings`` so the descriptor remains
    the single source of truth for the defaults (see ``Session.__init__``).
    """
    return {d["name"]: d["value"] for d in MAIN_SETTINGS}


def _main_descriptor(name: str) -> dict:
    for d in MAIN_SETTINGS:
        if d["name"] == name:
            return d
    raise KeyError(f"unknown main setting {name!r}")


def main_validate(name: str, value: Any) -> Any:
    """Coerce + bound a client-sent global setting value.

    Raises ``KeyError`` for an unknown name and ``ValueError`` for an
    uncoercible / out-of-range value (same contract as ``validate``).
    """
    return _coerce(_main_descriptor(name), value, name)
