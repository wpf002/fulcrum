# Fulcrum

Two-sided real estate intelligence. Predicts likely sellers from public
property records, captures consented buyers via embeddable intent tools,
and matches supply to demand inside one agent's territory. Closings
retrain the seller model.

## Why it's different
- SmartZip/Offrs predict sellers. Zillow captures buyers. Nobody holds
  both ends of the same transaction. Fulcrum does — that's the moat.
- Buyer funnel earns from day one (no data partnerships, full consent).
- Seller model trains on public records alone.
- Matching makes it un-cancellable once an agent has both.

## Hard rules
- Buyer data is opt-in only (Consent is a required FK on every lead).
- Seller data is public records + licensed feeds only. No credit files,
  no bank data, no health data.
- Money is integer cents everywhere.
- Every score ships with Factor[] provenance.

## Stack
TS/pnpm Turborepo · Next.js 15 (web) · Fastify (api) · Prisma/Postgres ·
Redis (match streams) · Python FastAPI + LightGBM (ml) · Railway.

## Structure
apps/web · apps/api · services/ml · packages/{db,types,widget,config,ingest}

## Local dev
1. `pnpm install`
2. copy `.env.example` -> `.env`, fill values
3. `pnpm db:migrate && pnpm db:seed`
4. `pnpm dev`  (web :3000, api :3001)
5. `cd services/ml && uvicorn main:app --reload`  (ml :8000)

## Roadmap
See FULCRUM_BUILD_PLAN.md. Phase 0 (ground-truth proof) is the gate —
if the seller model has no lift on one metro, stop.
