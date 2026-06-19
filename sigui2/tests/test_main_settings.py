"""Unit tests for the application-global settings catalog (F2).

Pure-module tests of the flat MAIN_SETTINGS catalog + validation. The WebSocket
round-trip / visibility-trim / broadcast behavior is covered in test_protocol.py.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sigui2.server import view_settings  # noqa: E402


def test_main_defaults_match_catalog():
    d = view_settings.main_defaults()
    assert d["max_visible_units"] == 10
    # Every declared descriptor seeds a default value.
    for desc in view_settings.MAIN_SETTINGS:
        assert d[desc["name"]] == desc["value"]


def test_main_validate_clamps_and_coerces():
    assert view_settings.main_validate("max_visible_units", 999) == 50  # clamp hi
    assert view_settings.main_validate("max_visible_units", 0) == 1     # clamp lo
    v = view_settings.main_validate("max_visible_units", "7")
    assert isinstance(v, int) and v == 7                                # str -> int


def test_main_validate_rejects_unknown_name():
    with pytest.raises(KeyError):
        view_settings.main_validate("nope", 1)


def test_main_validate_rejects_uncoercible_value():
    with pytest.raises(ValueError):
        view_settings.main_validate("max_visible_units", "not-a-number")


def test_main_catalog_is_a_copy():
    cat = view_settings.main_catalog()
    cat[0]["value"] = 999  # mutate the returned copy
    assert view_settings.MAIN_SETTINGS[0]["value"] != 999  # source untouched
