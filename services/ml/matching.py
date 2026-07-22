"""Match scorer (Phase 4).

The money formula (build plan §5):
    matchScore = criteriaFit(geo, price, beds/baths/type)
               × listLikelihood            (the seller model's P(list))
               × buyerReadiness            (the buyer's readiness score)

All three factors are in [0, 1]; the product is a joint probability-like score.
Every pairing ships with Factor[] provenance explaining why it surfaced.
"""

from __future__ import annotations


def _price_fit(value_cents, lo_cents, hi_cents) -> tuple[float, str]:
    """1.0 inside the buyer's band, decaying to 0 outside a 15% margin."""
    if value_cents is None:
        return 0.5, "Price unknown"
    v = float(value_cents)
    lo = float(lo_cents) if lo_cents is not None else 0.0
    hi = float(hi_cents) if hi_cents is not None else float("inf")
    if lo <= v <= hi:
        return 1.0, "Within budget"
    # linear decay over a 15% margin beyond each edge
    if v < lo:
        margin = lo * 0.15
        frac = max(0.0, 1.0 - (lo - v) / margin) if margin else 0.0
        return frac, ("Just under budget" if frac > 0 else "Below budget")
    margin = hi * 0.15
    frac = max(0.0, 1.0 - (v - hi) / margin) if margin else 0.0
    return frac, ("Slightly over budget" if frac > 0 else "Over budget")


def _geo_fit(prop_zip, target_geos: list[str]) -> tuple[float, str]:
    if not target_geos:
        return 0.6, "No zip preference"
    if prop_zip in target_geos:
        return 1.0, f"In target zip {prop_zip}"
    return 0.0, "Outside target zips"


def score_pair(lead: dict, prop: dict) -> dict | None:
    """Score one (buyer, property) pair. Returns None if geography excludes it."""
    geo_fit, geo_label = _geo_fit(prop.get("zip"), lead.get("targetGeographies") or [])
    if geo_fit == 0.0:
        return None

    price_fit, price_label = _price_fit(
        prop.get("avmEstimateCents"),
        lead.get("priceBandMinCents"),
        lead.get("priceBandMaxCents"),
    )
    criteria_fit = round(geo_fit * price_fit, 4)
    if criteria_fit == 0.0:
        return None

    list_likelihood = float(prop.get("listLikelihood") or 0.0)  # 0..1
    buyer_readiness = float(lead.get("readinessScore") or 0) / 100.0

    match_score = round(criteria_fit * list_likelihood * buyer_readiness, 6)

    seller_score = int(round(list_likelihood * 100))
    factors = [
        {"label": geo_label, "weight": round(geo_fit, 2), "direction": "up"},
        {
            "label": price_label,
            "weight": round(price_fit, 2),
            "direction": "up" if price_fit >= 0.5 else "down",
        },
        {"label": f"Likely to list ({seller_score})", "weight": round(list_likelihood, 2), "direction": "up"},
        {
            "label": f"Buyer ready ({lead.get('readinessScore')})",
            "weight": round(buyer_readiness, 2),
            "direction": "up",
        },
    ]

    return {
        "propertyId": prop.get("id"),
        "buyerLeadId": lead.get("id"),
        "matchScore": match_score,
        "criteriaFit": criteria_fit,
        "listLikelihood": round(list_likelihood, 4),
        "buyerReadiness": round(buyer_readiness, 4),
        "factors": factors,
    }
