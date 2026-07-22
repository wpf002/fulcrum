"""Score the current (2025-07-20) Travis County snapshot with the Phase 0
model and emit per-property Factor[] provenance.

Trains on the gate dataset (2022→2024 pair), scores every property in the
score2025 feature build, and writes a compact CSV the Phase 1 ingest worker
loads into SellerScore rows:

  NDJSON lines: {prop_id, probability, score (county percentile 0-100),
  factors, model_version}

Factors come from LightGBM's per-row feature contributions (pred_contrib),
so every score explains itself — the non-negotiable from the build plan.

Usage: python score_current.py <train.parquet> <score.parquet> <out.csv.gz>
"""


import gzip
import json
import sys

import lightgbm as lgb
import numpy as np
import pandas as pd

from train import CATEGORICAL, FEATURES, SEED

MODEL_VERSION = "phase0-2022t2024-lgbm-v1"


UNKNOWN_LABELS = {
    "tenure_months": "Tenure unknown",
    "age_years": "Home age unknown",
    "value_change_1yr": "No prior-year value",
    "value_per_sqft": "Living area unknown",
    "main_area": "Living area unknown",
    "hood_turnover": "No neighborhood history",
    "zip_turnover": "No zip history",
    "hood_median_tenure": "No neighborhood history",
    "log_market_value": "Market value unknown",
    "land_share": "Land share unknown",
}


def factor_label(feat: str, row: pd.Series) -> str:
    v = row.get(feat)
    if pd.isna(v) and feat in UNKNOWN_LABELS:
        return UNKNOWN_LABELS[feat]
    if feat == "tenure_months" and pd.notna(v):
        return f"Ownership tenure {v / 12:.0f} yrs"
    if feat == "age_years" and pd.notna(v):
        return f"Home age {v:.0f} yrs"
    if feat == "value_change_1yr" and pd.notna(v):
        return f"Appraised value {v:+.0%} yr/yr"
    if feat == "hood_turnover" and pd.notna(v):
        return f"Neighborhood turnover {v:.0%}/2yr"
    if feat == "zip_turnover" and pd.notna(v):
        return f"Zip turnover {v:.0%}/2yr"
    if feat == "hood_median_tenure" and pd.notna(v):
        return f"Neighborhood median tenure {v / 12:.0f} yrs"
    if feat == "value_per_sqft" and pd.notna(v):
        return f"Value ${v:.0f}/sqft"
    if feat == "log_market_value" and pd.notna(v):
        return f"Market value ~${np.expm1(v) / 1000:.0f}k"
    if feat == "main_area" and pd.notna(v):
        return f"Living area {v:.0f} sqft"
    if feat == "land_share" and pd.notna(v):
        return f"Land {v:.0%} of value"
    flags = {
        "absentee": "Absentee owner",
        "out_of_state": "Out-of-state owner",
        "po_box_owner": "PO-box owner address",
        "entity_owner": "Entity-owned (LLC/trust)",
        "owner_mismatch": "Owner-of-record mismatch",
        "arb_protest": "ARB protest on file",
        "hs_exempt": "Homestead exemption",
        "ov65_exempt": "Over-65 exemption",
        "dp_exempt": "Disability exemption",
        "has_mortgage": "Mortgage on file",
        "has_tax_agent": "Tax agent hired",
        "lost_homestead": "Homestead recently dropped",
        "gained_homestead": "Homestead recently added",
        "recent_owner_change": "Owner changed last year",
        "has_hs_cap": "Homestead cap active",
    }
    if feat in flags:
        return flags[feat] if v == 1 else f"No {flags[feat].lower()}"
    if feat == "hood_cd":
        h = row.get("hood_cd")
        return f"Neighborhood {h}" if pd.notna(h) and str(h) not in ("nan", "UNK") else "Neighborhood signal"
    if feat == "situs_zip5":
        z = row.get("situs_zip5")
        return f"Zip {z}" if pd.notna(z) and str(z) not in ("nan", "UNK") else "Zip-level signal"
    return feat


def main(train_path: str, score_path: str, out_path: str) -> None:
    tr = pd.read_parquet(train_path)
    sc = pd.read_parquet(score_path)

    for c in CATEGORICAL:
        tr[c] = tr[c].astype("category")
        sc[c] = pd.Categorical(sc[c], categories=tr[c].cat.categories)

    model = lgb.LGBMClassifier(
        n_estimators=600,
        learning_rate=0.05,
        num_leaves=127,
        min_child_samples=50,
        subsample=0.9,
        subsample_freq=1,
        colsample_bytree=0.8,
        random_state=SEED,
        n_jobs=-1,
        verbosity=-1,
    )
    model.fit(tr[FEATURES], tr["label"])

    X = sc[FEATURES]
    prob = model.predict_proba(X)[:, 1]
    pct = pd.Series(prob).rank(pct=True).values * 100  # county percentile

    contrib = model.booster_.predict(X, pred_contrib=True)[:, :-1]  # drop bias

    n_factors = 4
    with gzip.open(out_path, "wt") as f:
        top_idx = np.argsort(-np.abs(contrib), axis=1)[:, :n_factors]
        for i in range(len(sc)):
            row = sc.iloc[i]
            factors = []
            for j in top_idx[i]:
                c = float(contrib[i, j])
                if c == 0.0:
                    continue
                factors.append(
                    {
                        "label": factor_label(FEATURES[j], row),
                        "weight": round(abs(c), 4),
                        "direction": "up" if c > 0 else "down",
                    }
                )
            f.write(
                json.dumps(
                    {
                        "prop_id": row["prop_id"],
                        "probability": round(float(prob[i]), 6),
                        "score": int(round(pct[i])),
                        "factors": factors,
                        "model_version": MODEL_VERSION,
                    }
                )
                + "\n"
            )
    print(f"scored {len(sc)} properties -> {out_path}")
    print(f"prob: min={prob.min():.4f} median={np.median(prob):.4f} max={prob.max():.4f}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
