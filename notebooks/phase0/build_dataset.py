"""Build the Phase 0 training dataset for Travis County.

Design (leakage-free by construction):
  - Features come ONLY from data available at the 2022-04-09 snapshot:
    the 2022 appraisal export plus the 2021 export (prior-year trajectory).
  - Label = deed transfer within N months AFTER the snapshot, read from the
    2024-08-21 certified export's deed_dt (which reflects the latest deed).
  - Universe = single-family residential (imprv_state_cd A*) present in both
    snapshots with a positive market value.

Texas is a non-disclosure state — sale prices are not public — so the target
is "ownership transferred" (deed recorded), which is exactly the event a
listing-prediction product cares about. Caveat: deed transfers include some
non-arms-length events (transfers into trusts, divorce quitclaims). That
noise is acceptable for the Phase 0 gate and those events are themselves
list-adjacent signals.

Neighborhood aggregates (turnover, tenure) are computed strictly from
pre-snapshot deed dates, so they leak nothing from the label window.

Usage:
  python build_dataset.py <extracted_dir> <out_parquet>              # 2022→2024 pair
  python build_dataset.py <extracted_dir> <out_parquet> temporal2024 # 2024→2025 pair
"""

import re
import sys
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

# Snapshot pairs: features from `feat` (+ `prior` trajectory), labels from
# `label` export's deed_dt in (snapshot, label_end].
PAIRS = {
    "default": dict(
        feat="prop_2022.csv.gz",
        prior="prop_2021.csv.gz",
        label="prop_2024.csv.gz",
        impdet="impdet_2022.csv.gz",
        snapshot=datetime(2022, 4, 9),
        label_end=datetime(2024, 4, 9),
    ),
    # out-of-time check: 2024 features (prior = 2022, a 2-year delta), labels
    # from the 2025 certified export — an ~11-month window.
    "temporal2024": dict(
        feat="prop_2024.csv.gz",
        prior="prop_2022.csv.gz",
        label="prop_2025.csv.gz",
        impdet="impdet_2024.csv.gz",
        snapshot=datetime(2024, 8, 21),
        label_end=datetime(2025, 7, 20),
    ),
    # current-snapshot scoring (no labels exist yet — label column is all
    # zeros and must be ignored; this build exists to produce features).
    "score2025": dict(
        feat="prop_2025.csv.gz",
        prior="prop_2024.csv.gz",
        label="prop_2025.csv.gz",
        impdet="impdet_2025.csv.gz",
        snapshot=datetime(2025, 7, 20),
        label_end=datetime(2025, 7, 21),
    ),
}

ENTITY_RE = re.compile(
    r"\b(?:LLC|L L C|LP|LLP|LTD|INC|CORP|CO|TRUST|TR|PARTNERS|PARTNERSHIP|"
    r"HOLDINGS|PROPERTIES|INVESTMENTS?|VENTURES?|HOMES|GROUP|FUND|CHURCH|"
    r"CITY OF|COUNTY|AUTHORITY|FOUNDATION|ASSN|ASSOCIATION|ESTATES?)\b"
)
PO_BOX_RE = re.compile(r"\bP\.?\s*O\.?\s*BOX\b|\bBOX\s+\d")


def parse_deed(s: pd.Series) -> pd.Series:
    """Deed dates appear as MM-DD-YYYY (2022+) or MMDDYYYY (2021 vintage)."""
    raw = s.fillna("").str.strip()
    d1 = pd.to_datetime(raw, format="%m-%d-%Y", errors="coerce")
    d2 = pd.to_datetime(raw.where(d1.isna()), format="%m%d%Y", errors="coerce")
    return d1.fillna(d2)


def to_num(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s, errors="coerce")


def main(extracted: str, out: str, pair: str = "default") -> None:
    cfg = PAIRS[pair]
    SNAPSHOT = cfg["snapshot"]
    LABEL_END = cfg["label_end"]
    TURNOVER_LOOKBACK_START = SNAPSHOT - timedelta(days=730)
    p21 = pd.read_csv(f"{extracted}/{cfg['prior']}", dtype=str)
    p22 = pd.read_csv(f"{extracted}/{cfg['feat']}", dtype=str)
    p24 = pd.read_csv(f"{extracted}/{cfg['label']}", dtype=str)
    imp = pd.read_csv(f"{extracted}/{cfg['impdet']}", dtype={"prop_id": str})
    print(f"pair={pair} prior={len(p21)}  feat={len(p22)}  label={len(p24)}  impdet={len(imp)}")

    # ── universe: single-family residential in 2022, still on the 2024 roll ──
    p22 = p22[p22["imprv_state_cd"].fillna("").str.startswith("A")]
    p22["market_value"] = to_num(p22["market_value"]).fillna(0)
    p22 = p22[p22["market_value"] > 0]
    print(f"2022 single-family universe: {len(p22)}")

    labels = p24[["prop_id", "deed_dt", "py_owner_name"]].rename(
        columns={"deed_dt": "deed_dt_2024", "py_owner_name": "owner_2024"}
    )
    df = p22.merge(labels, on="prop_id", how="inner")
    print(f"joined to 2024 roll: {len(df)}")

    # ── label: market sale = deed recorded in (snapshot, snapshot + 24mo]
    # AND the owner actually changed AND it isn't a same-family/trust transfer
    # (first name token shared between old and new owner). Family transfers,
    # trust restatements, and deed re-records are not listings — counting them
    # as positives rewards predicting paperwork, not sales. ──
    deed24 = parse_deed(df["deed_dt_2024"])
    in_window = (deed24 > SNAPSHOT) & (deed24 <= LABEL_END)
    old_owner = df["py_owner_name"].fillna("").str.strip().str.upper()
    new_owner = df["owner_2024"].fillna("").str.strip().str.upper()
    owner_changed = (old_owner != new_owner) & (new_owner != "")
    same_family = (
        (old_owner.str.split().str[0] == new_owner.str.split().str[0])
        & (old_owner.str.split().str[0] != "")
    )
    df["label"] = (in_window & owner_changed & ~same_family).astype(int)
    print(
        f"deeds in window: {int(in_window.sum())}  "
        f"→ market-sale labels after cleaning: {int(df['label'].sum())}"
    )

    # ── features: 2022 snapshot ──
    deed22 = parse_deed(df["deed_dt"])
    df["deed22"] = deed22
    df["tenure_months"] = (SNAPSHOT - deed22).dt.days / 30.44
    df.loc[df["tenure_months"] < 0, "tenure_months"] = np.nan
    df["has_deed_dt"] = deed22.notna().astype(int)
    df["has_deed_book"] = (df["deed_book_id"].fillna("").str.strip() != "").astype(int)

    situs_zip5 = df["situs_zip"].fillna("").str[:5]
    df["absentee"] = (
        (df["py_addr_zip"].fillna("") != situs_zip5) & (situs_zip5 != "")
    ).astype(int)
    state = df["py_addr_state"].fillna("").str.upper().str.strip()
    df["out_of_state"] = ((state != "TX") & (state != "")).astype(int)
    df["po_box_owner"] = (
        df["py_addr_line1"].fillna("").str.upper().str.contains(PO_BOX_RE)
    ).astype(int)
    df["entity_owner"] = (
        df["py_owner_name"].fillna("").str.upper().str.contains(ENTITY_RE)
    ).astype(int)
    df["owner_mismatch"] = (
        df["py_owner_name"].fillna("").str.strip()
        != df["jan1_owner_name"].fillna("").str.strip()
    ).astype(int)
    df["arb_protest"] = (df["arb_protest_flag"].fillna("F") == "T").astype(int)

    for col in ("hs_exempt", "ov65_exempt", "dp_exempt"):
        df[col] = (df[col].fillna("F") == "T").astype(int)

    df["has_mortgage"] = (to_num(df["mortgage_co_id"]).fillna(0) > 0).astype(int)
    df["has_tax_agent"] = (to_num(df["entity_agent_id"]).fillna(0) > 0).astype(int)

    for col in (
        "appraised_val",
        "assessed_val",
        "ten_percent_cap",
        "land_hstd_val",
        "land_non_hstd_val",
        "imprv_hstd_val",
        "imprv_non_hstd_val",
        "legal_acreage",
    ):
        df[col] = to_num(df[col]).fillna(0)
    df["legal_acreage"] = df["legal_acreage"] / 1e4  # 4 implied decimals

    df["log_market_value"] = np.log1p(df["market_value"])
    land = df["land_hstd_val"] + df["land_non_hstd_val"]
    df["land_share"] = (land / df["market_value"]).clip(0, 1)
    df["has_hs_cap"] = (df["ten_percent_cap"] > 0).astype(int)
    df["cap_ratio"] = (df["ten_percent_cap"] / df["market_value"]).clip(0, 1)

    # ── features: prior-year (2021) trajectory ──
    prior = p21[["prop_id", "appraised_val", "hs_exempt", "py_owner_name"]].rename(
        columns={
            "appraised_val": "appraised_2021",
            "hs_exempt": "hs_2021",
            "py_owner_name": "owner_2021",
        }
    )
    df = df.merge(prior, on="prop_id", how="left")
    df["appraised_2021"] = to_num(df["appraised_2021"])
    df["value_change_1yr"] = np.where(
        df["appraised_2021"] > 0,
        df["appraised_val"] / df["appraised_2021"] - 1,
        np.nan,
    )
    df["lost_homestead"] = (
        (df["hs_2021"].fillna("F") == "T") & (df["hs_exempt"] == 0)
    ).astype(int)
    df["gained_homestead"] = (
        (df["hs_2021"].fillna("F") == "F") & (df["hs_exempt"] == 1)
    ).astype(int)
    df["recent_owner_change"] = (
        df["owner_2021"].notna()
        & (
            df["owner_2021"].fillna("").str.strip()
            != df["py_owner_name"].fillna("").str.strip()
        )
    ).astype(int)

    # ── improvement details (2022) ──
    imp["yr_built"] = to_num(imp["yr_built"])
    imp["main_area"] = to_num(imp["main_area"])
    df = df.merge(imp[["prop_id", "yr_built", "main_area"]], on="prop_id", how="left")
    df["age_years"] = SNAPSHOT.year - df["yr_built"]
    df.loc[(df["age_years"] < 0) | (df["age_years"] > 200), "age_years"] = np.nan
    df["value_per_sqft"] = np.where(
        df["main_area"] > 300, df["market_value"] / df["main_area"], np.nan
    )

    # ── neighborhood aggregates from PRE-snapshot deeds only ──
    df["hood_cd"] = df["hood_cd"].fillna("UNK")
    df["situs_zip5"] = situs_zip5.replace("", "UNK")
    pre_turnover = (
        (df["deed22"] > TURNOVER_LOOKBACK_START) & (df["deed22"] <= SNAPSHOT)
    ).astype(int)
    df["_pre_turn"] = pre_turnover
    for key, prefix in (("hood_cd", "hood"), ("situs_zip5", "zip")):
        g = df.groupby(key, observed=True).agg(
            **{
                f"{prefix}_turnover": ("_pre_turn", "mean"),
                f"{prefix}_median_tenure": ("tenure_months", "median"),
                f"{prefix}_n": ("prop_id", "count"),
            }
        )
        df = df.merge(g, left_on=key, right_index=True, how="left")
    df = df.drop(columns=["_pre_turn"])

    df["hood_cd"] = df["hood_cd"].astype("category")
    df["situs_zip5"] = df["situs_zip5"].astype("category")

    keep = [
        "prop_id",
        "label",
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
    out_df = df[keep]
    out_df.to_parquet(out, index=False)
    months = (LABEL_END - SNAPSHOT).days / 30.44
    print(f"\nwrote {out}: {len(out_df)} rows")
    print(f"base rate (market sale within {months:.0f}mo): {out_df['label'].mean():.4f}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "default")
