# Travis County probate ingest (PROBATE events)

A probate filing names a decedent; we resolve that decedent to the Travis
property they owned and, for confident matches only, write a `PROBATE`
PropertyEvent that triggers a rescore.

## ⚠️ Source restrictions (read first)

Two sources are **off limits**, both verified directly:

| Source | Why not |
|---|---|
| **Odyssey portal** (`odysseyweb.traviscountytx.gov`) | SmartSearch is **reCAPTCHA**-gated behind an F5 WAF; Tyler's Terms forbid automated access. We do not bypass bot protection. |
| **texaspublicnotices.com** (TX Press Association) | Its Terms of Use prohibit using site content **"in any database, compilation, archive or cache"** and prohibit **"screen scraping … or use of any other automated means to collect information from the site."** Notice detail pages are additionally **challenge-gated**. We do not scrape or ingest it — *even manually saved pages*, since the ToU bars database use of the content. |

> Note: `robots.txt` on texaspublicnotices allows `/` and the *search* page has
> no CAPTCHA, which is misleading — the binding restriction is in the Terms of
> Use and on the detail pages. Checking robots.txt alone is not sufficient.

## Authorized sources

| Source | Adapter | Gate |
|---|---|---|
| **UniCourt LDaaS** (recommended) | `sources/unicourt.ts` | `UNICOURT_API_KEY` |
| re:SearchTX data agreement / County Clerk bulk records / vendor feed | `sources/export-file.ts` (CSV/JSON) | `--file <path>` |
| Notice prose from any licensed/authorized source | `sources/public-notice.ts` (`probateNoticesFromFile`) | `--notices-file <path>` |

All produce the same `ProbateFiling`, so the matcher and pipeline are
source-agnostic — swapping sources is a one-line change.

## Run

```bash
UNICOURT_API_KEY=… ML_SERVICE_URL=http://localhost:8010 \
  REDIS_URL=redis://localhost:6380 pnpm --filter @fulcrum/ingest ingest:probate

# or a structured export you're authorized to use
pnpm --filter @fulcrum/ingest ingest:probate --file ./probate_export.csv \
  --since 2025-01-01 --min-confidence 0.5
```

## Matching (`match.ts`)

TCAD stores owners ~"LAST FIRST MIDDLE"; filings read "First Last" or "Estate of
First Last". We match on the order-independent set of significant name tokens,
require both a surname and a given-name hit, score by token overlap, and
**quarantine below `--min-confidence`** (default 0.5) — a wrong match is worse
than a miss. Entity-owned parcels are excluded (probate is an individual event).

The parser (`sources/public-notice.ts`) turns standardized Notice-to-Creditors
prose (Estates Code §308.051) into structured filings and is unit-tested; it
works on any legitimately-obtained copy of that prose.
