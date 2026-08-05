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
which files/records/maintains Notice of Trustee Sales and offers a public
records search. Options:

1. **County Clerk records** — the recorded trustee-sale notices (public records
   search / bulk records subscription).
2. **A licensed vendor feed** — several sell structured TX trustee-sale data.

Both deliver notice text/records that `foreclosure-ingest.ts --file` parses.

## Run

```bash
ML_SERVICE_URL=http://localhost:8010 REDIS_URL=redis://localhost:6380 \
  pnpm --filter @fulcrum/ingest foreclosure:ingest --file ./trustee_sales.txt \
  --since 2026-01-01
```

Anything without a confidently-matched address is quarantined, never guessed.
