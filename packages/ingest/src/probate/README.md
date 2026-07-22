# Travis County probate ingest

Real-source wiring for the probate event feed (replaces the earlier synthesized
feed). A filing names a decedent; we resolve that decedent to the Travis
property they owned and, for confident matches only, write a `PROBATE`
PropertyEvent that triggers a rescore.

## Access reality (why there's no live scraper)

There is **no free, unauthenticated feed** of Travis County probate filings:

- **Odyssey portal** (`odysseyweb.traviscountytx.gov/Portal/`) — the SmartSearch
  is **reCAPTCHA**-gated and sits behind an F5 WAF, and Tyler's Terms of Use
  forbid automated access. We do **not** scrape it (no CAPTCHA bypass).
- **Docket Search Application** (`publiccourts.traviscountytx.gov/dsa/`) —
  criminal dockets only, no probate.

Production ingestion therefore uses a **licensed source**. Adapters:

| Source | Adapter | Gate |
|---|---|---|
| **UniCourt LDaaS** (recommended) | `sources/unicourt.ts` | `UNICOURT_API_KEY` |
| re:SearchTX bulk / County Clerk bulk / manual export / public-notice scrape | `sources/export-file.ts` (CSV or JSON) | `--file <path>` |

Both produce the same `ProbateFiling` shape, so the matcher + pipeline are
source-agnostic.

## Run

```bash
# licensed API
UNICOURT_API_KEY=… ML_SERVICE_URL=http://localhost:8010 \
  REDIS_URL=redis://localhost:6380 pnpm --filter @fulcrum/ingest ingest:probate

# real export file (re:SearchTX / bulk / notices)
ML_SERVICE_URL=http://localhost:8010 REDIS_URL=redis://localhost:6380 \
  pnpm --filter @fulcrum/ingest ingest:probate --file ./probate_export.csv \
  --since 2025-01-01 --min-confidence 0.5
```

## Matching (`match.ts`)

TCAD stores owners ~"LAST FIRST MIDDLE"; filings read "First Last" or "Estate of
First Last". We match on the order-independent set of significant name tokens,
require both a surname and a given-name hit, score by token overlap, and
**quarantine below `--min-confidence`** (default 0.5) — a wrong match is worse
than a miss. Entity-owned parcels are excluded (probate is an individual event).

## Export format

CSV or JSON with case-insensitive keys:
`causeNumber, decedentName, filedAt, caseType` (aliases accepted — see
`export-file.ts`).
