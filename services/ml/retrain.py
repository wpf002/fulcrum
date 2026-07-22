"""Monthly retrain with kill criteria + model versioning (Phase 5).

The flywheel: confirmed outcomes become new training labels. This folds the
2024→2025 outcome cohort into the original 2022→2024 training data, retrains,
and validates precision@top-decile on a holdout.

KILL CRITERIA (build plan §6): a candidate ships ONLY if its top-decile
precision beats the incumbent on the holdout. If it can't clear the base rate
by a meaningful margin at all, the seller product doesn't exist — stop.
Every candidate is versioned into models/registry.json whether it ships or not.

Usage: python retrain.py <phase0_dataset.parquet> <temporal.parquet> <models_dir>
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

from features import CATEGORICAL_FEATURES, FEATURES

SEED = 42
KILL_MIN_LIFT = 1.5  # if even the incumbent can't clear this, the product is dead


def precision_at_frac(y, s, frac):
    k = max(1, int(len(s) * frac))
    idx = np.argsort(-s)[:k]
    return float(np.asarray(y)[idx].mean())


def prep(df):
    df = df[[*FEATURES, "label"]].copy()
    for c in CATEGORICAL_FEATURES:
        df[c] = df[c].astype("category")
    return df


def train_eval(train_df, test_df):
    for c in CATEGORICAL_FEATURES:
        cats = train_df[c].cat.categories
        test_df[c] = pd.Categorical(test_df[c], categories=cats)
    m = lgb.LGBMClassifier(
        n_estimators=700, learning_rate=0.05, num_leaves=63,
        min_child_samples=100, subsample=0.9, subsample_freq=1,
        colsample_bytree=0.9, random_state=SEED, n_jobs=-1, verbosity=-1,
    )
    m.fit(train_df[FEATURES], train_df["label"], categorical_feature=CATEGORICAL_FEATURES)
    s = m.predict_proba(test_df[FEATURES])[:, 1]
    y = test_df["label"].values
    base = float(y.mean())
    p10 = precision_at_frac(y, s, 0.10)
    return m, base, p10


def main(phase0_path, temporal_path, models_dir):
    models = Path(models_dir)
    meta = json.loads((models / "feature_meta.json").read_text())
    incumbent_p10 = meta["holdout_precision_at_top_decile"]
    incumbent_ver = meta["model_version"]

    base_df = prep(pd.read_parquet(phase0_path))
    outcome_df = prep(pd.read_parquet(temporal_path))  # the new confirmed labels
    print(f"incumbent {incumbent_ver}: holdout p@10 = {incumbent_p10:.4f}")
    print(f"training data: {len(base_df)} original + {len(outcome_df)} new outcomes")

    # hold out a slice of the NEWEST cohort — validate on the freshest reality
    out_tr, holdout = train_test_split(
        outcome_df, test_size=0.30, stratify=outcome_df["label"], random_state=SEED
    )
    combined = pd.concat([base_df, out_tr], ignore_index=True)
    for c in CATEGORICAL_FEATURES:
        combined[c] = combined[c].astype("category")

    _, base_rate, cand_p10 = train_eval(combined, holdout)
    # score the incumbent on the same holdout for an apples-to-apples compare
    inc_model = lgb.Booster(model_file=str(models / "seller_serving.txt"))
    hz = holdout[[*[f for f in FEATURES if f not in CATEGORICAL_FEATURES]]].copy()
    hz["situs_zip5"] = pd.Categorical(holdout["situs_zip5"].astype(str), categories=meta["zip_categories"])
    hz = hz[FEATURES]
    inc_p10 = precision_at_frac(holdout["label"].values, inc_model.predict(hz), 0.10)

    candidate_ver = f"seller-serving-v3-{datetime.now(timezone.utc).strftime('%Y%m')}"
    ships = cand_p10 > inc_p10 and (cand_p10 / base_rate) >= KILL_MIN_LIFT

    print(f"\nholdout base rate: {base_rate:.4f}")
    print(f"incumbent on holdout:  p@10 = {inc_p10:.4f}  (lift {inc_p10/base_rate:.2f}x)")
    print(f"candidate  on holdout: p@10 = {cand_p10:.4f}  (lift {cand_p10/base_rate:.2f}x)")
    print(f"\nKILL GATE — candidate must beat incumbent AND clear {KILL_MIN_LIFT}x base:")
    print(f"  {'SHIP' if ships else 'HOLD'} {candidate_ver}")
    if not ships:
        print("  incumbent stays in production (kill criteria not met)")

    # version every candidate, shipped or not
    registry_path = models / "registry.json"
    registry = json.loads(registry_path.read_text()) if registry_path.exists() else {"models": []}
    registry["models"].append({
        "version": candidate_ver,
        "trained_at": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "training_rows": int(len(combined)),
        "new_outcomes_folded_in": int(len(out_tr)),
        "holdout_base_rate": round(base_rate, 4),
        "incumbent_p10": round(inc_p10, 4),
        "candidate_p10": round(cand_p10, 4),
        "candidate_lift": round(cand_p10 / base_rate, 2),
        "shipped": ships,
        "vs_incumbent": incumbent_ver,
    })
    registry_path.write_text(json.dumps(registry, indent=2))
    print(f"\nlogged candidate to {registry_path} ({len(registry['models'])} total)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
