"""Unit tests for the match scorer (no DB needed)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from matching import score_pair

LEAD = {
    "id": "lead1",
    "targetGeographies": ["78704"],
    "priceBandMinCents": 27000000,  # $270k
    "priceBandMaxCents": 32000000,  # $320k
    "readinessScore": 100,
}


def test_perfect_match_is_product_of_factors():
    prop = {"id": "p1", "zip": "78704", "avmEstimateCents": 29000000, "listLikelihood": 0.8}
    m = score_pair(LEAD, prop)
    assert m is not None
    # criteriaFit(1.0) * listLikelihood(0.8) * readiness(1.0)
    assert abs(m["matchScore"] - 0.8) < 1e-6
    assert m["criteriaFit"] == 1.0


def test_geography_outside_target_excludes_the_pair():
    prop = {"id": "p2", "zip": "78745", "avmEstimateCents": 29000000, "listLikelihood": 0.9}
    assert score_pair(LEAD, prop) is None


def test_price_far_over_budget_drops_criteria_fit_to_zero():
    prop = {"id": "p3", "zip": "78704", "avmEstimateCents": 90000000, "listLikelihood": 0.9}
    # >15% over the $320k ceiling → price fit 0 → pair excluded
    assert score_pair(LEAD, prop) is None


def test_readiness_scales_the_score():
    prop = {"id": "p4", "zip": "78704", "avmEstimateCents": 29000000, "listLikelihood": 0.8}
    cold = score_pair({**LEAD, "readinessScore": 50}, prop)
    warm = score_pair({**LEAD, "readinessScore": 100}, prop)
    assert cold["matchScore"] < warm["matchScore"]
