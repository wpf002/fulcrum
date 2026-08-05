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

## Run

```bash
# free fetch (best-effort — see caveat), then ingest
pnpm --filter @fulcrum/ingest fetch:foreclosures ./foreclosures.html --months 3
ML_SERVICE_URL=http://localhost:8010 REDIS_URL=redis://localhost:6380 \
  pnpm --filter @fulcrum/ingest foreclosure:ingest --file ./foreclosures.html
```

## Fetch caveat (honest)

texaspublicnotices.com is free, robots-allowed, and has no CAPTCHA, and the
**county checkbox** filter works (keyword filtering does **not** — searching
"Travis County" matches the *person* "Travis L. Smith" in other counties, so
`fetch-foreclosures.ts` sets the county checkbox `lstCounty_221` directly).

But foreclosure results are **truncated** in the list (`… click 'view' to open
the full text`) and the property address lives on each notice's detail view,
which is a dynamic WebForms postback that resists automation. The fetch script
attempts the click-through best-effort; the **reliable** inputs are:

1. a saved file of notice detail pages (open the results, save the text), or
2. a licensed foreclosure feed (many vendors sell TX trustee-sale data).

Either way `foreclosure-ingest.ts --file` parses it, and anything without a
confidently-matched address is quarantined rather than guessed.
