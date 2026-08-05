# Travis County foreclosure ingest (NOD_PREFORECLOSURE)

The second event signal after probate. Texas requires a **Notice of Substitute
Trustee's Sale** before a non-judicial foreclosure (Property Code §51.002); it
names the property and the sale date. Pre-foreclosure is the model's
second-strongest prior (3.5×) — an owner in default is very likely to sell.

Unlike probate (matched by decedent **name**), these are matched by **address**.

## Pipeline

```
notices → parse.ts (address, zip, sale date, TS ref)
        → address.ts (normalize + resolve to a Property; quarantine if unsure)
        → NOD_PREFORECLOSURE PropertyEvent
        → events/rescore.ts (shared with probate: enqueue → ml → SellerScore)
```

## Address matching (`address.ts`)

TCAD stores situs addresses as `1711 CROWN DR` (abbreviated suffix, uppercase,
zip in its own column). Notices read `1711 Crown Drive, Austin, TX 78745`. We
canonicalize both to `<house#> <STREET> <SUFFIX>`:

- USPS-style suffix map (`DRIVE→DR`, `TRAIL→TRL`, `COVE→CV`, …)
- directional words → letters (`SOUTH→S`)
- strip city/state/zip tail and unit markers (`APT 4`, `#12`, `STE 200`)
- require house number **and** canonical street name to match (zip too when the
  notice carries one) — anything else is **quarantined**, never guessed.

## Where to get the notices

**Not from a newspaper aggregator.** Texas non-judicial foreclosure (Property
Code §51.002) requires the notice to be *posted at the courthouse, filed with
the county clerk, and mailed to the debtor* — newspaper publication is **not**
required. Verified empirically: searching texaspublicnotices.com for
"Substitute Trustee" with the Travis county filter returns **"No public notices
found."** (Broader keyword searches there return "Board of Trustees" school
notices, not foreclosures.) That aggregator is also off limits on Terms-of-Use
grounds — see `../probate/README.md`.

The authoritative source is the **Travis County Clerk's Recording Division**,
which files/records/maintains Notice of Trustee Sales. Access options, with
what was actually verified:

| Path | Automatable? | Cost | Notes |
|---|---|---|---|
| **tccsearch.org** (Clerk's public records search) | ❌ **No** | free | `robots.txt` has `User-agent: ClaudeBot → Disallow: /` **and** a catch-all `User-agent: * → Disallow: /`. Crawling is disallowed; the UI is for human lookup. |
| **Clerk bulk/subscription data** | ✅ likely | $ (ask) | Not documented publicly — **call the Recording Division, 512-854-9188 opt 7**. Many TX clerks sell bulk recorded-document data; this is the cleanest authorized programmatic path. |
| **Licensed vendor** (TexasFile, foreclosure-data vendors) | ✅ yes | $$ | Sells structured TX trustee-sale records. |
| **Monthly manual pull** | n/a (human) | free | Texas foreclosure auctions are the **first Tuesday of each month**, so notices arrive in a monthly batch — a person runs the search, saves the notices, and drops the file into `foreclosure:ingest`. Legitimate (intended human use of the portal) and only ~once a month. |

The **monthly manual pull** is the practical zero-cost path today; a clerk bulk
subscription is the upgrade when volume justifies it. Every option feeds the
same `--file` ingest, so switching is a one-line change.

## Run

```bash
ML_SERVICE_URL=http://localhost:8010 REDIS_URL=redis://localhost:6380 \
  pnpm --filter @fulcrum/ingest foreclosure:ingest --file ./trustee_sales.txt \
  --since 2026-01-01
```

Anything without a confidently-matched address is quarantined, never guessed.
