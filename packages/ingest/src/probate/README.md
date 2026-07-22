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

## Sources (free first)

| Source | Cost | Adapter | Gate |
|---|---|---|---|
| **Texas "Notice to Creditors"** (texaspublicnotices.com) | **free** | `sources/public-notice.ts` | `--notices-file <results.html>` or `--live-notices` |
| re:SearchTX bulk / County Clerk bulk / manual export | free–$ | `sources/export-file.ts` (CSV/JSON) | `--file <path>` |
| UniCourt LDaaS | $$ (enterprise) | `sources/unicourt.ts` | `UNICOURT_API_KEY` |

All produce the same `ProbateFiling`, so the matcher + pipeline are
source-agnostic.

### Free: Texas public notices (recommended to start)

When a Texas estate opens, the executor must **publish a Notice to Creditors**
naming the decedent, cause number, and court (Estates Code §308.051). The Texas
Press Association aggregates every county's notices for free at
**texaspublicnotices.com** — `robots.txt` allows `/`, there's no CAPTCHA, and
public access is the site's purpose. `public-notice.ts` parses that notice prose
into filings.

Fetch note: the site's search is ASP.NET WebForms that renders results via an
async postback, so a raw HTTP client can't reliably drive it (`--live-notices`
is best-effort). The **reliable, still-free** path is a scheduled **headless
browser** (Playwright) — or a human — running the Travis + "Letters Testamentary"
search and saving the results page, then:

```bash
ML_SERVICE_URL=http://localhost:8010 REDIS_URL=redis://localhost:6380 \
  pnpm --filter @fulcrum/ingest ingest:probate --notices-file ./results.html
```

Respect the site's Terms of Use; keep any automated fetch polite (low rate).

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
