"""Serving feature contract for the seller model.

The productionized model can only use features reconstructable from what the
ingest actually persists on Property + PropertyEvent (see packages/db schema).
That is a strict subset of the Phase 0 research features — the richer signals
(neighborhood turnover, appraisal-value trajectory, building age) live in the
raw county extracts and become a Phase 6 feature-store task.

Both training (train_serving.py) and serving (main.py) build the vector here,
so they cannot drift.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone

# Numeric features, in model order. Categorical `situs_zip5` is appended last.
NUMERIC_FEATURES = [
    "tenure_months",
    "entity_owner",
    "absentee",
    "log_market_value",
]
CATEGORICAL_FEATURES = ["situs_zip5"]
FEATURES = NUMERIC_FEATURES + CATEGORICAL_FEATURES


def property_to_features(prop: dict) -> dict:
    """Build the model feature row from a Property DB record.

    Expects keys: ownershipTenureMonths, ownerType, avmEstimateCents,
    assessedValueCents, zip.
    """
    tenure = prop.get("ownershipTenureMonths")
    owner_type = (prop.get("ownerType") or "").upper()
    avm = prop.get("avmEstimateCents")
    assessed = prop.get("assessedValueCents")

    market = None
    if avm is not None:
        market = float(avm) / 100.0
    elif assessed is not None:
        market = float(assessed) / 100.0

    return {
        "tenure_months": float(tenure) if tenure is not None else math.nan,
        "entity_owner": 1 if owner_type == "ENTITY" else 0,
        "absentee": 1 if owner_type == "ABSENTEE" else 0,
        "log_market_value": math.log1p(market) if market and market > 0 else math.nan,
        "situs_zip5": (prop.get("zip") or "UNK"),
    }


# ── event priors ──
# No probate/NOD labels exist in the training data yet, so their weights can't
# be learned by the base model. We encode them as explainable odds multipliers
# (domain priors) applied by the serving layer; Phase 5's outcome loop will
# learn the true weights once tracked sales accumulate. Each entry:
#   (label, odds_multiplier, decay_days)  — effect decays linearly to 0 over
#   decay_days from the event date.
EVENT_PRIORS = {
    "PROBATE": ("Probate filing", 4.0, 540),
    "NOD_PREFORECLOSURE": ("Pre-foreclosure notice", 3.5, 365),
    "DIVORCE_FILING": ("Divorce filing", 2.2, 540),
    "TAX_DELINQUENT": ("Tax delinquent", 1.8, 730),
    "LIEN": ("Lien filed", 1.5, 540),
    "CODE_VIOLATION": ("Code violation", 1.3, 365),
}


def apply_event_priors(base_p: float, events: list[dict], now: datetime | None = None):
    """Combine the base model probability with event odds multipliers.

    Returns (final_probability, event_factors). Multipliers act on odds so the
    result stays a valid probability; effects decay with event age.
    """
    now = now or datetime.now(timezone.utc)
    odds = base_p / (1 - base_p) if 0 < base_p < 1 else max(base_p, 1e-6)
    factors: list[dict] = []

    # keep only the strongest still-active instance of each event type
    best: dict[str, float] = {}
    for ev in events:
        etype = ev.get("type")
        prior = EVENT_PRIORS.get(etype)
        if not prior:
            continue
        _, mult, decay_days = prior
        occurred = ev.get("occurredAt")
        if isinstance(occurred, str):
            occurred = datetime.fromisoformat(occurred.replace("Z", "+00:00"))
        if occurred and occurred.tzinfo is None:
            occurred = occurred.replace(tzinfo=timezone.utc)
        age_days = (now - occurred).days if occurred else 0
        if age_days > decay_days:
            continue
        decay = max(0.0, 1.0 - age_days / decay_days)
        effective = 1.0 + (mult - 1.0) * decay
        if effective > best.get(etype, 0):
            best[etype] = effective

    for etype, effective in best.items():
        label, _, _ = EVENT_PRIORS[etype]
        odds *= effective
        factors.append(
            {
                "label": label,
                "weight": round(math.log(effective), 4),
                "direction": "up",
            }
        )

    final_p = odds / (1 + odds)
    return min(final_p, 0.995), factors
