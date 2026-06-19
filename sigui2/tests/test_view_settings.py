"""Unit tests for the per-view settings catalog (F1).

Pure-module tests of the descriptor catalog + validation. The WebSocket
round-trip / broadcast / scatter-reshape behavior is covered in test_protocol.py.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sigui2.server import view_settings  # noqa: E402


def test_defaults_match_catalog():
    d = view_settings.defaults()
    assert d["scatter"]["max_spikes_per_unit"] == 100_000
    assert d["scatter"]["scatter_size"] == pytest.approx(1.2)
    # Every declared descriptor seeds a default value.
    for view, descriptors in view_settings.VIEW_SETTINGS.items():
        for desc in descriptors:
            assert d[view][desc["name"]] == desc["value"]


def test_validate_clamps_and_coerces_numeric():
    assert view_settings.validate("scatter", "max_spikes_per_unit", 9_999_999) == 1_000_000
    assert view_settings.validate("scatter", "max_spikes_per_unit", 0) == 1_000  # clamp lo
    assert view_settings.validate("scatter", "max_spikes_per_unit", "5000") == 5000  # str -> int
    size = view_settings.validate("scatter", "scatter_size", 2)
    assert isinstance(size, float) and size == 2.0  # int -> float
    assert view_settings.validate("scatter", "scatter_size", 100.0) == 8.0  # clamp hi


def test_validate_rejects_unknown_view_or_name():
    with pytest.raises(KeyError):
        view_settings.validate("nope", "x", 1)
    with pytest.raises(KeyError):
        view_settings.validate("scatter", "nope", 1)


def test_validate_rejects_uncoercible_value():
    with pytest.raises(ValueError):
        view_settings.validate("scatter", "max_spikes_per_unit", "not-a-number")


def test_catalog_is_a_copy():
    cat = view_settings.catalog()
    cat["scatter"][0]["value"] = 999  # mutate the returned copy
    assert view_settings.VIEW_SETTINGS["scatter"][0]["value"] != 999  # source untouched
