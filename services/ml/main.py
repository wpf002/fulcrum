"""fulcrum-ml: seller model + match scorer.

Serves the LightGBM seller model behind FastAPI. /score/seller reads a
property and its events from Postgres, scores it with the base model, layers
explainable event priors (probate, pre-foreclosure, ...), and returns a
probability, a 0–100 score, and Factor[] provenance. The caller persists the
SellerScore (keeps a single Prisma writer + cuid ids).
"""

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
import psycopg
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from features import (
    CATEGORICAL_FEATURES,
    FEATURES,
    NUMERIC_FEATURES,
    apply_event_priors,
    property_to_features,
)
from matching import score_pair

MODELS = Path(__file__).parent / "models"
DB_URL = (
    os.environ.get("DATABASE_URL")
    or "postgresql://fulcrum:fulcrum@localhost:5437/fulcrum"
).replace("postgresql://", "postgresql://")

app = FastAPI(title="fulcrum-ml")

_booster = lgb.Booster(model_file=str(MODELS / "seller_serving.txt"))
_meta = json.loads((MODELS / "feature_meta.json").read_text())
_zip_categories = _meta["zip_categories"]
MODEL_VERSION = _meta["model_version"]


def _humanize(feat: str, value, contrib: float) -> str:
    up = contrib > 0
    if feat == "tenure_months" and not math.isnan(value):
        return f"Ownership tenure {value / 12:.0f} yrs"
    if feat == "log_market_value" and not math.isnan(value):
        return f"Market value ~${math.expm1(value) / 1000:.0f}k"
    if feat == "entity_owner":
        return "Entity-owned (LLC/trust)" if value == 1 else "Individually owned"
    if feat == "absentee":
        return "Absentee owner" if value == 1 else "Owner-occupied"
    if feat == "situs_zip5":
        return f"Zip {value}"
    return feat


def _model_score(prop: dict):
    """Base probability + factors from the serving LightGBM model."""
    feats = property_to_features(prop)
    row = {f: feats[f] for f in NUMERIC_FEATURES}
    df = pd.DataFrame([row])
    df["situs_zip5"] = pd.Categorical([feats["situs_zip5"]], categories=_zip_categories)
    df = df[FEATURES]

    base_p = float(_booster.predict(df)[0])
    contribs = _booster.predict(df, pred_contrib=True)[0][:-1]  # drop bias
    factors = []
    for i, feat in enumerate(FEATURES):
        c = float(contribs[i])
        if abs(c) < 1e-4:
            continue
        factors.append(
            {
                "label": _humanize(feat, feats[feat], c),
                "weight": round(abs(c), 4),
                "direction": "up" if c > 0 else "down",
            }
        )
    factors.sort(key=lambda f: -f["weight"])
    return base_p, factors


def _score_property(prop: dict, events: list[dict], prior_prob, prior_factors) -> dict:
    # Base signal: the property's current best estimate. Where a score already
    # exists (the richer Phase 0 model, loaded in Phase 1) we layer events onto
    # that and keep its explanations; otherwise we cold-score with the serving
    # LightGBM. Either way events are explainable priors on top.
    if prior_prob is not None:
        base_p = float(prior_prob)
        base_factors = list(prior_factors or [])
        base_version = "phase0-2022t2024-lgbm-v1"
    else:
        base_p, base_factors = _model_score(prop)
        base_version = MODEL_VERSION

    final_p, event_factors = apply_event_priors(base_p, events)
    # fresh event signal first, then the base explanations
    factors = (event_factors + base_factors)[:5]

    return {
        "probability": round(final_p, 6),
        "base_probability": round(base_p, 6),
        "score": int(round(final_p * 100)),
        "velocity": round((final_p - base_p) * 100, 2),  # event-driven delta
        "factors": factors,
        "modelVersion": f"{base_version}+events" if event_factors else base_version,
    }


class SellerScoreRequest(BaseModel):
    propertyId: str


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "fulcrum-ml",
        "modelVersion": MODEL_VERSION,
        "holdoutLift": _meta.get("holdout_lift"),
    }


@app.post("/score/seller")
def score_seller(req: SellerScoreRequest):
    with psycopg.connect(DB_URL) as conn:
        prop_row = conn.execute(
            """SELECT id, "ownershipTenureMonths", "ownerType",
                      "avmEstimateCents", "assessedValueCents", zip
               FROM "Property" WHERE id = %s""",
            (req.propertyId,),
        ).fetchone()
        if not prop_row:
            raise HTTPException(status_code=404, detail="unknown property")
        prop = {
            "id": prop_row[0],
            "ownershipTenureMonths": prop_row[1],
            "ownerType": prop_row[2],
            "avmEstimateCents": prop_row[3],
            "assessedValueCents": prop_row[4],
            "zip": prop_row[5],
        }
        event_rows = conn.execute(
            'SELECT type, "occurredAt" FROM "PropertyEvent" WHERE "propertyId" = %s',
            (req.propertyId,),
        ).fetchall()
        prior = conn.execute(
            '''SELECT "probabilityListMonths", factors FROM "SellerScore"
               WHERE "propertyId" = %s ORDER BY "computedAt" DESC LIMIT 1''',
            (req.propertyId,),
        ).fetchone()
    events = [{"type": r[0], "occurredAt": r[1]} for r in event_rows]
    prior_prob = prior[0] if prior else None
    prior_factors = prior[1] if prior else None

    result = _score_property(prop, events, prior_prob, prior_factors)
    result["propertyId"] = req.propertyId
    return result


class MatchRequest(BaseModel):
    buyerLeadId: str
    propertyIds: list[str]


@app.post("/score/match")
def score_match(req: MatchRequest):
    """Score a buyer lead against candidate properties. Returns ranked pairs."""
    if not req.propertyIds:
        return {"buyerLeadId": req.buyerLeadId, "matches": []}

    with psycopg.connect(DB_URL) as conn:
        lead_row = conn.execute(
            '''SELECT id, "priceBandMinCents", "priceBandMaxCents",
                      "targetGeographies", "minBeds", "readinessScore"
               FROM "BuyerLead" WHERE id = %s''',
            (req.buyerLeadId,),
        ).fetchone()
        if not lead_row:
            raise HTTPException(status_code=404, detail="unknown buyer lead")
        lead = {
            "id": lead_row[0],
            "priceBandMinCents": lead_row[1],
            "priceBandMaxCents": lead_row[2],
            "targetGeographies": lead_row[3],
            "minBeds": lead_row[4],
            "readinessScore": lead_row[5],
        }

        # candidate properties + their latest seller-score probability
        rows = conn.execute(
            '''SELECT p.id, p.zip, p."avmEstimateCents", p."addressLine1",
                      p."ownerType", s."probabilityListMonths"
               FROM "Property" p
               JOIN LATERAL (
                 SELECT "probabilityListMonths" FROM "SellerScore" s
                 WHERE s."propertyId" = p.id
                 ORDER BY s."computedAt" DESC LIMIT 1
               ) s ON true
               WHERE p.id = ANY(%s)''',
            (req.propertyIds,),
        ).fetchall()

    matches = []
    for r in rows:
        prop = {
            "id": r[0],
            "zip": r[1],
            "avmEstimateCents": r[2],
            "addressLine1": r[3],
            "ownerType": r[4],
            "listLikelihood": float(r[5]) if r[5] is not None else 0.0,
        }
        scored = score_pair(lead, prop)
        if scored:
            matches.append(scored)

    matches.sort(key=lambda m: -m["matchScore"])
    return {"buyerLeadId": req.buyerLeadId, "matches": matches}
