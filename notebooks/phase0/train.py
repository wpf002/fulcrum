"""Phase 0 gate: train LightGBM, measure precision@top-decile vs base rate.

Ship gate (FULCRUM_BUILD_PLAN.md §7 Phase 0): the top decile of scored
properties must convert meaningfully above the base rate on a holdout.
If it doesn't, the seller product doesn't exist — report honestly.

Usage: python train.py <dataset.parquet> <results.json>
"""

import json
import sys

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import train_test_split

FEATURES = [
    "tenure_months",
    "has_deed_dt",
    "has_deed_book",
    "absentee",
    "out_of_state",
    "po_box_owner",
    "entity_owner",
    "owner_mismatch",
    "arb_protest",
    "hs_exempt",
    "ov65_exempt",
    "dp_exempt",
    "has_mortgage",
    "has_tax_agent",
    "log_market_value",
    "land_share",
    "has_hs_cap",
    "cap_ratio",
    "legal_acreage",
    "value_change_1yr",
    "lost_homestead",
    "gained_homestead",
    "recent_owner_change",
    "age_years",
    "main_area",
    "value_per_sqft",
    "hood_turnover",
    "hood_median_tenure",
    "hood_n",
    "zip_turnover",
    "zip_median_tenure",
    "hood_cd",
    "situs_zip5",
]
CATEGORICAL = ["hood_cd", "situs_zip5"]
SEED = 42


def precision_at_frac(y_true: np.ndarray, y_score: np.ndarray, frac: float) -> float:
    k = max(1, int(len(y_score) * frac))
    idx = np.argsort(-y_score)[:k]
    return float(y_true[idx].mean())


def main(dataset_path: str, results_path: str) -> None:
    df = pd.read_parquet(dataset_path)
    for c in CATEGORICAL:
        df[c] = df[c].astype("category")

    X = df[FEATURES]
    y = df["label"].values

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=SEED
    )
    X_tr, X_val, y_tr, y_val = train_test_split(
        X_train, y_train, test_size=0.15, stratify=y_train, random_state=SEED
    )

    configs = [
        dict(learning_rate=0.03, num_leaves=63, min_child_samples=100),
        dict(learning_rate=0.05, num_leaves=127, min_child_samples=50),
        dict(learning_rate=0.02, num_leaves=255, min_child_samples=200),
        dict(learning_rate=0.05, num_leaves=31, min_child_samples=300),
    ]
    best_ap, model = -1.0, None
    for cfg in configs:
        m = lgb.LGBMClassifier(
            n_estimators=3000,
            subsample=0.9,
            subsample_freq=1,
            colsample_bytree=0.8,
            random_state=SEED,
            n_jobs=-1,
            verbosity=-1,
            **cfg,
        )
        m.fit(
            X_tr,
            y_tr,
            eval_set=[(X_val, y_val)],
            eval_metric="average_precision",
            callbacks=[lgb.early_stopping(150, verbose=False), lgb.log_evaluation(0)],
        )
        ap = average_precision_score(y_val, m.predict_proba(X_val)[:, 1])
        print(f"cfg {cfg} -> val AP {ap:.4f} @ iter {m.best_iteration_}")
        if ap > best_ap:
            best_ap, model = ap, m

    score = model.predict_proba(X_test)[:, 1]
    base = float(y_test.mean())
    p10 = precision_at_frac(y_test, score, 0.10)
    p5 = precision_at_frac(y_test, score, 0.05)
    p1 = precision_at_frac(y_test, score, 0.01)

    # decile table
    order = np.argsort(-score)
    deciles = []
    for d in range(10):
        lo, hi = int(len(order) * d / 10), int(len(order) * (d + 1) / 10)
        deciles.append(float(y_test[order[lo:hi]].mean()))

    # segment metric: the realtor farming target = individually-owned homes
    seg = X_test["entity_owner"].values == 0
    seg_base = float(y_test[seg].mean())
    seg_p10 = precision_at_frac(y_test[seg], score[seg], 0.10)

    gain = model.booster_.feature_importance(importance_type="gain")
    importances = sorted(
        zip(FEATURES, [float(g) for g in gain]), key=lambda t: -t[1]
    )

    results = {
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
        "base_rate": base,
        "precision_at_top_decile": p10,
        "lift_at_top_decile": p10 / base if base else None,
        "precision_at_top_5pct": p5,
        "precision_at_top_1pct": p1,
        "roc_auc": float(roc_auc_score(y_test, score)),
        "pr_auc": float(average_precision_score(y_test, score)),
        "individual_owner_base_rate": seg_base,
        "individual_owner_precision_at_top_decile": seg_p10,
        "individual_owner_lift_at_top_decile": seg_p10 / seg_base if seg_base else None,
        "decile_conversion": deciles,
        "best_iteration": int(model.best_iteration_ or 0),
        "feature_importance_gain": importances,
    }
    with open(results_path, "w") as f:
        json.dump(results, f, indent=2)

    print(json.dumps({k: v for k, v in results.items() if k != "feature_importance_gain"}, indent=2))
    print("\nTop features by gain:")
    for name, g in importances[:12]:
        print(f"  {name:20s} {g:14.0f}")
    verdict = "PASS" if p10 >= 2 * base else "FAIL"
    print(f"\nGATE ({'>=2x base rate' if True else ''}): {verdict}  "
          f"(top decile {p10:.3f} vs base {base:.3f}, lift {p10/base:.2f}x)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
