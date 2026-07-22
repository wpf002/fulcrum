"""Build the outcome cohort — the flywheel's ground truth (Phase 5).

Predictions made on the 2024-08 snapshot, validated against ACTUAL sales
observed in the 2025-07 county export. This is real outcome confirmation, not
synthesized: the label is a real deed transfer, the sale date is a real deed
date. Texas is non-disclosure so sale PRICE isn't public — days-to-sale and the
sold/not-sold outcome are, which is what the model is validated on.

Outputs:
  - track_record.json : aggregate model track record (precision@top-decile,
    lift, days-to-sale, top predictive factors) over the full farm cohort
  - outcomes_sold.csv  : the confirmed sales, for the DB outcome loader

Usage: python build_outcomes.py <temporal.parquet> <prop_2025.csv.gz> <models_dir> <out_dir>
"""

import gzip
import json
import sys
from datetime import datetime
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

from features import CATEGORICAL_FEATURES, FEATURES, NUMERIC_FEATURES

SNAPSHOT_2024 = datetime(2024, 8, 21)
FARM_ZIPS = ["78704", "78745", "78748", "78749"]

FACTOR_LABELS = {
    "tenure_months": "Ownership tenure",
    "entity_owner": "Entity ownership",
    "absentee": "Absentee owner",
    "log_market_value": "Market value",
    "situs_zip5": "Neighborhood (zip)",
}


def load_deed_dates(csv_path: str, want: set[str]) -> dict[str, datetime]:
    """prop_id -> 2025 deed date, for the properties we care about."""
    out: dict[str, datetime] = {}
    with gzip.open(csv_path, "rt") as f:
        header = f.readline().rstrip("\n").split(",")
        pi, di = header.index("prop_id"), header.index("deed_dt")
        for line in f:
            parts = line.rstrip("\n").split(",")
            pid = parts[pi].strip()
            if pid not in want:
                continue
            raw = parts[di].strip()
            for fmt in ("%m-%d-%Y", "%m%d%Y"):
                try:
                    out[pid] = datetime.strptime(raw, fmt)
                    break
                except ValueError:
                    continue
    return out


def precision_at_frac(y, s, frac):
    k = max(1, int(len(s) * frac))
    idx = np.argsort(-s)[:k]
    return float(np.asarray(y)[idx].mean())


def main(temporal_path, prop2025_path, models_dir, out_dir):
    models = Path(models_dir)
    booster = lgb.Booster(model_file=str(models / "seller_serving.txt"))
    meta = json.loads((models / "feature_meta.json").read_text())
    zip_cats = meta["zip_categories"]

    df = pd.read_parquet(temporal_path)
    df = df[df["situs_zip5"].astype(str).isin(FARM_ZIPS)].copy()
    print(f"farm cohort (2024 predictions): {len(df)}  real sales: {int(df['label'].sum())}")

    # score the 2024 snapshot with the productionized serving model
    X = df[NUMERIC_FEATURES].copy()
    X["situs_zip5"] = pd.Categorical(df["situs_zip5"].astype(str), categories=zip_cats)
    X = X[FEATURES]
    df["pred_prob"] = booster.predict(X)

    y = df["label"].values
    base = float(y.mean())
    p10 = precision_at_frac(y, df["pred_prob"].values, 0.10)

    # days-from-flag-to-sale, from real deed dates on the sold properties
    sold = df[df["label"] == 1].copy()
    deed = load_deed_dates(prop2025_path, set(sold["prop_id"]))
    sold["sold_date"] = sold["prop_id"].map(deed)
    sold = sold[sold["sold_date"].notna()]
    sold["days_to_sale"] = (sold["sold_date"] - SNAPSHOT_2024).dt.days
    sold = sold[(sold["days_to_sale"] > 0) & (sold["days_to_sale"] <= 400)]

    # top predictive factors (model gain)
    gain = booster.feature_importance(importance_type="gain")
    top = sorted(zip(FEATURES, gain), key=lambda t: -t[1])[:4]
    top_factors = [{"factor": FACTOR_LABELS.get(f, f), "importance": round(float(g), 1)} for f, g in top]

    # is the sale attributable to a tracked funnel buyer? (filled by the loader
    # from Match rows; reported here as 0 — DB knows the real count)
    track = {
        "model_version": meta["model_version"],
        "evaluated_window": "2024-08 → 2025-07 (Travis County farm)",
        "n_predictions": int(len(df)),
        "n_confirmed_sales": int(len(sold)),
        "base_rate": round(base, 4),
        "precision_at_top_decile": round(p10, 4),
        "lift_at_top_decile": round(p10 / base, 2) if base else None,
        "avg_days_to_sale": int(sold["days_to_sale"].mean()) if len(sold) else None,
        "median_days_to_sale": int(sold["days_to_sale"].median()) if len(sold) else None,
        "top_predictive_factors": top_factors,
    }
    out = Path(out_dir)
    (models / "track_record.json").write_text(json.dumps(track, indent=2))
    print(json.dumps(track, indent=2))

    sold_out = sold[["prop_id", "pred_prob", "sold_date", "days_to_sale"]].copy()
    sold_out["sold_date"] = sold_out["sold_date"].dt.strftime("%Y-%m-%d")
    sold_out["score"] = (sold_out["pred_prob"] * 100).round().astype(int)
    csv_path = out / "outcomes_sold.csv"
    sold_out.to_csv(csv_path, index=False)
    print(f"\nwrote {len(sold_out)} confirmed sales -> {csv_path}")
    print(f"wrote track record -> {models / 'track_record.json'}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4])
