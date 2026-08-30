"""Permit priors: ambiguous signal, split by intent, and downward priors work."""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from features import apply_event_priors, prior_key

NOW = datetime.now(timezone.utc)
def ev(t, days, payload=None):
    return {"type": t, "occurredAt": NOW - timedelta(days=days), "payload": payload}

def test_prep_permit_nudges_up_modestly():
    final, factors = apply_event_priors(0.20, [ev("PERMIT", 30, {"signal": "prep"})], now=NOW)
    assert final > 0.20
    assert final < 0.28  # modest, unlike probate
    assert factors[0]["direction"] == "up"

def test_major_renovation_pushes_DOWN():
    final, factors = apply_event_priors(0.20, [ev("PERMIT", 30, {"signal": "investment"})], now=NOW)
    assert final < 0.20
    assert factors[0]["direction"] == "down"
    assert factors[0]["weight"] > 0  # weight is magnitude, never negative

def test_permit_intent_resolves_to_the_right_prior():
    assert prior_key(ev("PERMIT", 1, {"signal": "investment"})) == "PERMIT_INVESTMENT"
    assert prior_key(ev("PERMIT", 1, {"signal": "prep"})) == "PERMIT"
    assert prior_key(ev("PERMIT", 1, None)) == "PERMIT"
    assert prior_key(ev("PROBATE", 1, None)) == "PROBATE"

def test_probate_still_outweighs_a_permit():
    p_permit, _ = apply_event_priors(0.20, [ev("PERMIT", 10, {"signal": "prep"})], now=NOW)
    p_probate, _ = apply_event_priors(0.20, [ev("PROBATE", 10, None)], now=NOW)
    assert p_probate > p_permit

def test_expired_permit_is_ignored():
    final, factors = apply_event_priors(0.20, [ev("PERMIT", 400, {"signal": "prep"})], now=NOW)
    assert final == 0.20 and factors == []
