# Fulcrum — Build Plan & Roadmap

Two-sided real estate intelligence. Predicts likely sellers from property-anchored
public data, captures consented buyers through embeddable intent tools, and matches
supply to demand inside a single agent's book. Closings retrain the seller model,
so the buyer side generates ground truth for the seller side.

Codename: Fulcrum · Repo: `wpf002/fulcrum` · Stack: TS/pnpm Turborepo (Next.js 15,
Fastify, Prisma, Postgres, Redis) + Python FastAPI ML service, Railway.

## 0. The one-paragraph thesis

SmartZip/Offrs know sellers. Zillow knows buyers. Nobody holds both ends of the same
transaction inside one agent's territory. Fulcrum does. The match layer ("you've got
3 warm buyers wanting a 3/2 under $450k in this zip, and here are 5 homes where the
owner is likely to list in 6 months — go knock") is only possible if you own both
sides, and it's the moat. The buyer funnel makes money on day one with zero data
partnerships and full consent; the seller model trains fine on public records alone;
matching turns them into one un-cancellable product once an agent has both flowing.

## 1. Non-negotiable constraints

Baked into the schema, not bolted on later.

- **Buyer data is opt-in only.** Every buyer record is tied to a `Consent` row: what
  they agreed to, when, which terms version, which channels (email/SMS/TCPA). No
  consent, no lead.
- **Seller data is public records + licensed property feeds only.** No FCRA credit
  files. No bank/transaction data. No health-adjacent data. This is the legal wall —
  the whole reason the "cold buyer prediction" version of this idea is dead, and why
  we predict sellers from property records instead.
- **State privacy laws still apply** (CA/TX/OR/VT data-broker + privacy). Consent
  terms are versioned so you can prove what a user saw.
- **Money is always integer cents.** No floats for currency, anywhere.
- **Every model output carries `Factor[]` provenance** — every score explains
  itself, because agents won't trust a black box and precision-at-top-decile is the
  trust metric.

## 2. Architecture

```
fulcrum/
├── apps/
│   ├── web/                 # Next.js 15 — agent dashboard + hosts embeddable tools
│   └── api/                 # Fastify — REST API, Prisma, auth, Redis publisher
├── services/
│   └── ml/                  # Python FastAPI — LightGBM seller model + match scorer
├── packages/
│   ├── db/                  # Prisma schema + client + migrations
│   ├── types/               # shared TS types (Factor, Match, scores, DTOs)
│   ├── widget/              # embeddable buyer-intent tools (standalone JS bundle)
│   ├── config/              # shared config
│   └── ingest/              # seller-side ingestion workers (county/MLS/court)
├── infra/                   # railway config, docker for ml service, seed scripts
└── notebooks/               # Phase 0 ground-truth proof
```

Data plane: Postgres (source of truth, via Prisma) + Redis (match queue via streams,
cache, RPC — XREADGROUP/BLPOP pattern). Deploy: Railway — `api`, `web`, `ml` as
separate services, one Postgres, one Redis.

## 3. Data model (the property graph)

The `Property` is the primary key of the entire system. Everything hangs off it.
Full field lists live in `packages/db/prisma/schema.prisma`:

- **Property** — the anchor. `(fips, apn)` unique, address + spatial fields,
  attributes, ownership, financials, identity-resolution status.
- **PropertyEvent** — time-series feature source for the seller model. Provenance
  mandatory — no event without a source.
- **SellerScore** — `probabilityListMonths`, 0–100 `score`, `velocity` (a property
  moving 40→70 in 30 days beats one parked at 75), `Factor[]`, `modelVersion`.
- **Agent** — the customer: brand config, subscription tier, territories.
- **BuyerLead** — captured demand: contact (only if consented), criteria, readiness,
  `consentId` required FK.
- **Consent** — first-class, load-bearing, immutable once written. Terms version,
  IP, tool source, channel opt-ins.
- **Match** — the money object. `matchScore = criteriaFit × listLikelihood ×
  buyerReadiness`, `Factor[]`, status lifecycle SURFACED → CONTACTED/DISMISSED/CONVERTED.
- **Outcome** — confirmed transaction. Ties back to the prior SellerScore
  (validates/refutes) and flags `viaTrackedBuyer`. Closes the training loop.

**Identity resolution:** deterministic join on `apn` wherever a parcel ID exists.
Probabilistic fallback on normalized `address + ownerName` with a confidence
threshold — below threshold, the record is quarantined, not surfaced. Bad matches
destroy agent trust faster than anything; err toward withholding.

## 4. The two intake pipes

**Pipe 1 — Seller side** (batch ingest, `packages/ingest`): workers pull public +
licensed data per metro (county assessor/recorder, ATTOM/CoreLogic-class feed,
MLS/IDX where licensed, court records for the niche). Normalize addresses → upsert
`Property`, append `PropertyEvent`. Nightly for events, weekly full refresh. On new
events, enqueue affected properties for ML rescoring.

**Pipe 2 — Buyer side** (real-time, first-party, `packages/widget`): agent embeds a
branded bundle — affordability calculator, rent-vs-buy, mortgage-readiness,
neighborhood matcher. On tool completion the widget captures consent inline and
POSTs to `api`, which validates consent → writes `Consent` + `BuyerLead`, computes
`readinessScore`, publishes to Redis stream `buyer.leads`. 100% opt-in. This is the
piece that makes money before any data partnership exists.

## 5. Match layer

Triggered on: new buyer lead, seller score crossing threshold, or nightly batch.
For an agent's territory: pull active BuyerLeads (demand) and high-SellerScore
Properties (supply) in overlapping geography + price band; score each pair
(`criteriaFit × listLikelihood × buyerReadiness`); write ranked `Match` rows with
`Factor[]`; surface in dashboard: "3 buyers want X · 5 likely-to-list homes match ·
door-knock these this week." Redis streams carry the queue (`buyer.leads` consumer
group + `match.requests`).

## 6. Training loop (the flywheel)

1. **Outcome ingest** (nightly): watch tracked properties in county recorder + MLS
   for sales → write `Outcome`.
2. **Labeling**: tie the Outcome back to the prior SellerScore. If a funnel buyer
   closed it, set `viaTrackedBuyer` — a labeled positive seller example in exactly
   the market where you have buyer volume.
3. **Retrain** (monthly): LightGBM, target = listed within N months, validate
   precision@top-decile on a holdout. Ship only if it beats the incumbent version.
   Version everything.
4. **Kill criteria**: if a model version doesn't beat production on the holdout, it
   doesn't ship. If precision@top-decile can't clear the base rate by a meaningful
   margin at all, the seller product doesn't exist — stop and reassess.

## 7. Roadmap

Each phase has a ship gate — don't advance until it's met.

- **Phase 0 — Ground-truth proof** (`notebooks/`, before further app investment):
  one metro, county deed/tax records + 24 months of sales, LightGBM, target = sold
  within N months. Gate: top decile converts meaningfully above base rate. If not,
  the seller product doesn't exist — pivot to buyer-funnel-only or reassess.
- **Phase 1 — Monorepo + property graph**: full Prisma schema, seller ingest for
  the Phase-0 metro with quarantine-threshold identity resolution, minimal dashboard
  listing scored properties. Gate: one metro ingested, deduped, visible.
- **Phase 2 — Buyer funnel** (revenue-first): embeddable widget bundle, inline
  consent capture → api → Redis, agent branding, lead inbox. Gate: a real consented
  lead lands with readiness score. Sellable alone — get 3–5 agents paying here.
- **Phase 3 — Seller model productionized**: LightGBM behind FastAPI, one niche
  event feed online (probate first), rescore-on-event pipeline. Gate: live scores
  with explanations refreshing as events land.
- **Phase 4 — Match layer**: Redis consumer groups, match scorer, dashboard match
  view. Gate: a genuine buyer↔property match a real agent would act on.
- **Phase 5 — Outcome loop + retraining**: outcome ingest, labeling, monthly
  retrain with kill criteria, Model Track Record surface. Gate: a full loop turns.
- **Phase 6 — Scale + GTM**: multi-metro (templatize per county), Follow Up Boss
  integration, MCP tools (`fulcrum_score`, `fulcrum_match`), API hardening.

## 8. Honest risk ledger

- **Cold-start / two-sided.** Mitigated by sequencing: funnel earns alone (Phase 2),
  seller model trains alone (Phase 0/3), matching switches on once both exist.
- **Ingest is the real grind.** Every county formats records differently. This is
  the actual cost center, not the ML. Templatize aggressively in Phase 6.
- **Incumbent moat on sellers.** SmartZip/Offrs have a decade of outcome data. The
  counter: buyer-side outcome loop they can't replicate + a niche wedge
  (probate/divorce/absentee) rather than fighting generic likely-seller.
- **Agent adoption.** Default UX = one score, one action. Complexity lives underneath.
- **Consent discipline is the whole legal story.** Required FK for exactly this reason.
