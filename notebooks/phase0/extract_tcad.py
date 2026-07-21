"""Stream-extract compact CSVs from TCAD fixed-width appraisal exports.

The PROP.TXT / APPRAISAL_INFO.TXT layout is TCAD's PACS "Legacy 8.0.x"
appraisal export. Field offsets below were verified identical across layout
versions 8.0.25 (2022), 8.0.30 (2024), and 8.0.33 (2025) against the
published layout workbooks and real records.

Zips use deflate64, which Python's zipfile can't read — we shell out to
`unzip -p` and parse stdin.

Usage:
  python extract_tcad.py prop    <zip> <member> <out.csv.gz>
  python extract_tcad.py impdet  <zip> <member> <out.csv.gz>
"""

import csv
import gzip
import subprocess
import sys

# (name, start, end) — 1-indexed inclusive, per the layout doc.
PROP_FIELDS = [
    ("prop_id", 1, 12),
    ("prop_type_cd", 13, 17),
    ("py_owner_name", 609, 678),
    ("py_addr_line1", 694, 753),
    ("py_addr_state", 924, 973),
    ("py_addr_zip", 979, 983),
    ("situs_zip", 1140, 1149),
    ("legal_acreage", 1660, 1675),
    ("abs_subdv_cd", 1676, 1685),
    ("hood_cd", 1686, 1695),
    ("land_hstd_val", 1796, 1810),
    ("land_non_hstd_val", 1811, 1825),
    ("imprv_hstd_val", 1826, 1840),
    ("imprv_non_hstd_val", 1841, 1855),
    ("appraised_val", 1916, 1930),
    ("ten_percent_cap", 1931, 1945),
    ("assessed_val", 1946, 1960),
    ("arb_protest_flag", 1981, 1981),
    ("deed_book_id", 1994, 2013),
    ("deed_dt", 2034, 2058),
    ("mortgage_co_id", 2059, 2070),
    ("jan1_owner_name", 2203, 2272),
    ("hs_exempt", 2609, 2609),
    ("ov65_exempt", 2610, 2610),
    ("dp_exempt", 2662, 2662),
    ("imprv_state_cd", 2732, 2741),
    ("entity_agent_id", 2792, 2803),
    ("market_value", 4214, 4227),
]

IMPDET_FIELDS = [
    ("prop_id", 1, 12),
    ("imprv_det_type_cd", 41, 50),
    ("imprv_det_class_cd", 76, 85),
    ("yr_built", 86, 89),
    ("imprv_det_area", 94, 108),
]


def stream_member(zip_path: str, member: str):
    proc = subprocess.Popen(
        ["unzip", "-p", zip_path, member],
        stdout=subprocess.PIPE,
        bufsize=1024 * 1024,
    )
    assert proc.stdout is not None
    for raw in proc.stdout:
        yield raw.decode("latin-1")
    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(f"unzip exited {proc.returncode} for {zip_path}:{member}")


def extract_prop(zip_path: str, member: str, out_path: str) -> None:
    """One row per prop_id (partial-owner records deduped), real property only."""
    seen: set[str] = set()
    n_in = n_out = 0
    with gzip.open(out_path, "wt", newline="") as f:
        w = csv.writer(f)
        w.writerow([name for name, _, _ in PROP_FIELDS])
        for line in stream_member(zip_path, member):
            n_in += 1
            if line[12:17].strip() != "R":  # real property only
                continue
            prop_id = line[0:12].strip()
            if prop_id in seen:
                continue  # additional partial-owner record for same property
            seen.add(prop_id)
            w.writerow([line[s - 1 : e].strip() for _, s, e in PROP_FIELDS])
            n_out += 1
    print(f"{zip_path}:{member} -> {out_path}  records_in={n_in} props_out={n_out}")


def extract_impdet(zip_path: str, member: str, out_path: str) -> None:
    """Aggregate improvement details: max area + min non-zero yr_built per prop."""
    agg: dict[str, list] = {}  # prop_id -> [max_area, min_yr_built, main_class]
    n_in = 0
    for line in stream_member(zip_path, member):
        n_in += 1
        prop_id = line[0:12].strip()
        try:
            area = float(line[93:108].strip() or 0)
        except ValueError:
            area = 0.0
        try:
            yr = int(line[85:89].strip() or 0)
        except ValueError:
            yr = 0
        det_type = line[40:50].strip()
        cls = line[75:85].strip()
        cur = agg.setdefault(prop_id, [0.0, 0, ""])
        # main-area rows drive living area; MA is the PACS main-area code
        if det_type.upper().startswith("MA"):
            cur[0] = max(cur[0], area)
            if not cur[2]:
                cur[2] = cls
        if yr > 0:
            cur[1] = min(cur[1], yr) if cur[1] else yr
    with gzip.open(out_path, "wt", newline="") as f:
        w = csv.writer(f)
        w.writerow(["prop_id", "main_area", "yr_built", "class_cd"])
        for prop_id, (area, yr, cls) in agg.items():
            w.writerow([prop_id, area, yr, cls])
    print(f"{zip_path}:{member} -> {out_path}  detail_rows={n_in} props={len(agg)}")


if __name__ == "__main__":
    mode, zip_path, member, out_path = sys.argv[1:5]
    if mode == "prop":
        extract_prop(zip_path, member, out_path)
    elif mode == "impdet":
        extract_impdet(zip_path, member, out_path)
    else:
        raise SystemExit(f"unknown mode {mode}")
