# Phase 0 — Ground-truth proof (Travis County, TX)

**Verdict: PASS.** A LightGBM seller model trained only on public appraisal-roll
data ranks Travis County single-family homes well enough that the top decile
converts at ~2x the base rate and the top 1% at ~4.5–5.7x, and the ranking
holds up out-of-time across a market-regime change. The seller product exists.
Proceed to Phase 1+ (per FULCRUM_BUILD_PLAN.md §7).

## Data

All public, from the Travis Central Appraisal District (PACS "Legacy 8.0.x"
fixed-width appraisal exports; deflate64 zips):

| Snapshot | Source | Role |
|---|---|---|
| 2021-08-02 | Wayback-archived TCAD export | prior-year trajectory features |
| 2022-04-09 | Wayback-archived TCAD export | feature snapshot |
| 2024-08-21 | Wayback-archived TCAD certified export | labels for the gate pair |
| 2025-07-20 | live traviscad.org certified export | labels for the out-of-time check |

Raw zips (~1.5GB) and extracts live outside the repo (scratchpad); the
scripts here reproduce everything from the public URLs.

## Method

- **Universe:** single-family residential (`imprv_state_cd A*`), positive
  market value, present in both feature and label snapshots (~331k gate /
  ~343k temporal).
- **Label (market sale within window):** a deed recorded after the snapshot
  (`deed_dt` in the later export), where the owner actually changed and the
  old/new owner don't share a first name token. That cleaning removes ~20%
  of raw deed events (family/trust transfers, deed re-records) that are not
  listings. Texas is non-disclosure, so the target is the transfer event,
  not price.
- **Features (snapshot-only, leakage-free):** ownership tenure from deed
  date; absentee/out-of-state/PO-box owner; entity owner; homestead, over-65,
  disabled exemptions; homestead-cap presence and ratio; mortgage-company
  presence; tax-agent presence; ARB protest flag; market value, land share,
  acreage; year built/age, living area, value-per-sqft; 1-yr appraised-value
  change; lost/gained homestead vs prior year; owner change vs prior year;
  neighborhood & zip turnover + median tenure computed strictly from
  pre-snapshot deeds; neighborhood/zip categoricals.
- **Model:** LightGBM, small config sweep on a validation split, early
  stopping on average precision.

## Results

Gate pair (features 2022-04, labels = market sale within 24 months), 20%
holdout, base rate 9.3% ([results.json](results/results.json)):

| Metric | Value |
|---|---|
| Precision @ top decile | **18.3%** (lift **1.97x**) |
| Precision @ top 5% | 23.2% (2.5x) |
| Precision @ top 1% | **52.9%** (**5.7x**) |
| ROC AUC | 0.609 |

Out-of-time check (train on the full gate pair; score the 2024-08 snapshot
against real 2025 deeds, an ~11-month window in a cold market the model never
saw; base rate 3.0%) ([results_temporal.json](results/results_temporal.json)):

| Metric | Value |
|---|---|
| Precision @ top decile | 6.1% (lift **1.99x**) |
| Precision @ top 1% | 13.8% (lift **4.5x**) |
| ROC AUC | 0.589 |

Top features by gain: neighborhood, tenure, property age, entity owner,
absentee, 1-yr value change, neighborhood turnover.

## Honest caveats

1. **The individual-owner segment is thinner.** Restricting to non-entity
   owners (the classic farming target), top-decile lift drops to ~1.5x.
   Entity/builder dispositions are the easiest positives. This is exactly
   the gap Phase 3's event feeds (probate, divorce, NOD, tax-delinquent)
   are meant to close — they target individual owners specifically.
2. **Labels are deed transfers, not MLS listings.** Some noise survives
   cleaning (LLC-to-LLC flips, unusual family names). Phase 5's outcome
   loop replaces this with listing/closing ground truth.
3. **This is the floor, not the ceiling.** No event data, no MLS history,
   no permits/code violations are in the model yet — appraisal-roll
   features alone clear the gate.

## Reproduce

```bash
# 1. download exports (see build history for URLs), then:
python extract_tcad.py prop   tcad_2021.zip PROP.TXT                                extracted/prop_2021.csv.gz
python extract_tcad.py prop   tcad_2022.zip 2022-04-09_2022_APPRAISAL_INFO.TXT      extracted/prop_2022.csv.gz
python extract_tcad.py prop   tcad_2024.zip PROP.TXT                                extracted/prop_2024.csv.gz
python extract_tcad.py prop   tcad_2025.zip PROP.TXT                                extracted/prop_2025.csv.gz
python extract_tcad.py impdet tcad_2022.zip 2022-04-09_2022_APPRAISAL_IMPROVEMENT_DETAIL.TXT extracted/impdet_2022.csv.gz
python extract_tcad.py impdet tcad_2024.zip IMP_DET.TXT                             extracted/impdet_2024.csv.gz
# 2. build + train
python build_dataset.py extracted dataset.parquet
python train.py dataset.parquet results/results.json
# 3. out-of-time check
python build_dataset.py extracted dataset_temporal.parquet temporal2024
python temporal_check.py dataset.parquet dataset_temporal.parquet results/results_temporal.json
```

## Phase 1 handoff

`score_current.py` trains on the gate pair and scores the current
(2025-07-20) snapshot with per-property `Factor[]` provenance
(LightGBM pred_contrib), emitting NDJSON that
`packages/ingest/src/load-scores.ts` loads into `SellerScore` rows:

```bash
python build_dataset.py extracted dataset_score2025.parquet score2025
python score_current.py dataset.parquet dataset_score2025.parquet scores_2025.ndjson.gz
```
