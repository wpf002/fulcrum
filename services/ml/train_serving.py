"""Train the servable seller model on serving-reconstructable features.

Unlike the Phase 0 research model (which used ~30 features, some only present
in the raw county extracts), this model uses ONLY features the ingest persists
on Property — so the exact same vector can be rebuilt at serving time from the
database. It is weaker than the Phase 0 proof model by design; that gap is the
Phase 6 feature-store work. Event signals (probate etc.) are layered on at
serving time as explainable priors (see features.py).

Usage: python train_serving.py <phase0_dataset.parquet> <models_dir>
"""

import json
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

from features import CATEGORICAL_FEATURES, FEATURES, NUMERIC_FEATURES

SEED = 42
MODEL_VERSION = "seller-serving-v2"


def precision_at_frac(y_true, y_score, frac):
    k = max(1, int(len(y_score) * frac))
    idx = np.argsort(-y_score)[:k]
    return float(np.asarray(y_true)[idx].mean())


def main(dataset_path: str, models_dir: str) -> None:
    df = pd.read_parquet(dataset_path)
    df = df[[*FEATURES, "label"]].copy()
    for c in CATEGORICAL_FEATURES:
        df[c] = df[c].astype("category")

    from sklearn.model_selection import train_test_split

    X, y = df[FEATURES], df["label"].values
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, stratify=y, random_state=SEED)

    model = lgb.LGBMClassifier(
        n_estimators=600,
        learning_rate=0.05,
        num_leaves=63,
        min_child_samples=100,
        subsample=0.9,
        subsample_freq=1,
        colsample_bytree=0.9,
        random_state=SEED,
        n_jobs=-1,
        verbosity=-1,
    )
    model.fit(X_tr, y_tr, categorical_feature=CATEGORICAL_FEATURES)

    score = model.predict_proba(X_te)[:, 1]
    base = float(y_te.mean())
    p10 = precision_at_frac(y_te, score, 0.10)
    print(f"serving model: base_rate={base:.4f} "
          f"p@10%={p10:.4f} lift={p10 / base:.2f}x "
          f"prob_range=[{score.min():.3f},{score.max():.3f}]")

    out = Path(models_dir)
    out.mkdir(parents=True, exist_ok=True)
    model.booster_.save_model(str(out / "seller_serving.txt"))

    # persist categorical vocab so serving reproduces identical codes
    zip_categories = list(df["situs_zip5"].cat.categories)
    meta = {
        "model_version": MODEL_VERSION,
        "numeric_features": NUMERIC_FEATURES,
        "categorical_features": CATEGORICAL_FEATURES,
        "features": FEATURES,
        "zip_categories": zip_categories,
        "base_rate": base,
        "holdout_precision_at_top_decile": p10,
        "holdout_lift": p10 / base,
    }
    (out / "feature_meta.json").write_text(json.dumps(meta, indent=2))
    print(f"saved model + meta to {out} ({len(zip_categories)} zip categories)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
