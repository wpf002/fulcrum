"""Unit tests for the seller feature builder + event priors (no DB needed)."""

import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from features import apply_event_priors, property_to_features


def test_property_to_features_entity():
    f = property_to_features(
        {"ownershipTenureMonths": 120, "ownerType": "ENTITY", "avmEstimateCents": 50000000, "zip": "78704"}
    )
    assert f["entity_owner"] == 1
    assert f["absentee"] == 0
    assert f["tenure_months"] == 120
    assert f["situs_zip5"] == "78704"
    assert f["log_market_value"] > 0


def test_property_to_features_absentee_and_missing_value():
    f = property_to_features(
        {"ownershipTenureMonths": None, "ownerType": "ABSENTEE", "avmEstimateCents": None, "assessedValueCents": None, "zip": "78745"}
    )
    assert f["absentee"] == 1
    assert f["entity_owner"] == 0
    assert math.isnan(f["tenure_months"])
    assert math.isnan(f["log_market_value"])


def test_recent_probate_boosts_and_explains():
    now = datetime.now(timezone.utc)
    events = [{"type": "PROBATE", "occurredAt": now - timedelta(days=10)}]
    final, factors = apply_event_priors(0.20, events, now=now)
    assert final > 0.20
    assert any(fac["label"] == "Probate filing" and fac["direction"] == "up" for fac in factors)


def test_expired_probate_is_ignored():
    now = datetime.now(timezone.utc)
    events = [{"type": "PROBATE", "occurredAt": now - timedelta(days=700)}]  # > 540d decay
    final, factors = apply_event_priors(0.20, events, now=now)
    assert final == 0.20
    assert factors == []


def test_no_events_leaves_probability_unchanged():
    final, factors = apply_event_priors(0.33, [])
    assert final == 0.33
    assert factors == []
