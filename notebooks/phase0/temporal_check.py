"""Out-of-time robustness check for the Phase 0 gate.

Train on the 2022→2024 pair (the gate dataset), then score every property in
the 2024-08-21 snapshot and evaluate against real 2025 deed labels (an
~11-month window the model never saw). This checks that the ranking holds up
across a very different market regime (2022 run-up vs 2024–25 cooldown).

Usage: python temporal_check.py <train.parquet> <temporal.parquet> <out.json>
"""

import json
import sys

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score

from train import CATEGORICAL, FEATURES, SEED, precision_at_frac


def main(train_path: str, temporal_path: str, out_path: str) -> None:
    tr = pd.read_parquet(train_path)
    te = pd.read_parquet(temporal_path)

    # align categorical vocabularies (unseen 2024 hoods map to NaN)
    for c in CATEGORICAL:
        tr[c] = tr[c].astype("category")
        te[c] = pd.Categorical(te[c], categories=tr[c].cat.categories)

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

    score = model.predict_proba(te[FEATURES])[:, 1]
    y = te["label"].values
    base = float(y.mean())
    p10 = precision_at_frac(y, score, 0.10)
    p1 = precision_at_frac(y, score, 0.01)

    results = {
        "n_train": int(len(tr)),
        "n_temporal": int(len(te)),
        "temporal_base_rate": base,
        "temporal_precision_at_top_decile": p10,
        "temporal_lift_at_top_decile": p10 / base if base else None,
        "temporal_precision_at_top_1pct": p1,
        "temporal_lift_at_top_1pct": p1 / base if base else None,
        "temporal_roc_auc": float(roc_auc_score(y, score)),
        "temporal_pr_auc": float(average_precision_score(y, score)),
    }
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
