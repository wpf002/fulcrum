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
2. infra: `docker run -d --name fulcrum-postgres -e POSTGRES_USER=fulcrum -e POSTGRES_PASSWORD=fulcrum -e POSTGRES_DB=fulcrum -p 5437:5432 postgres:16-alpine`
   and `docker run -d --name fulcrum-redis -p 6380:6379 redis:7-alpine`
3. copy `.env.example` -> `.env` (defaults point at the containers above)
4. `pnpm db:migrate && pnpm db:seed`
5. `pnpm dev`  (web :3000, api :3001)
6. `cd services/ml && uvicorn main:app --reload`  (ml :8000)

## Buyer funnel (Phase 2)
```bash
pnpm --filter @fulcrum/widget build          # bundle the embeddable widget
# then, with api running, open the demo agent landing page:
#   http://localhost:3011/widget/demo
# complete it → a consented BuyerLead lands in the dashboard at /leads
```
Agents embed it on their own site:
```html
<div id="fulcrum-widget"></div>
<script src="https://api.fulcrum.example/widget/fulcrum-widget.js"
        data-fulcrum-agent="AGENT_ID"></script>
```

## County ingest (Phase 1, templatized in Phase 6)
```bash
pnpm --filter @fulcrum/ingest ingest --list            # registered counties
pnpm --filter @fulcrum/ingest ingest travis <export.zip>   # any metro is a registry entry
# score with the Phase 0 model (notebooks/phase0/score_current.py), then:
pnpm --filter @fulcrum/ingest load:scores <scores.ndjson.gz>
```
Adding a same-format (PACS) county is a config entry in
`packages/ingest/src/counties/registry.ts`; a new vendor format is a sibling
reader next to `counties/pacs.ts`.

## Scale & integrations (Phase 6)
- **`@fulcrum/client`** — typed API client other projects/tools consume.
- **MCP tools** — plug Fulcrum into agent workflows (Claude, Cursor):
  ```bash
  FULCRUM_API_URL=http://localhost:3011 pnpm --filter @fulcrum/mcp start
  ```
  exposes `fulcrum_score`, `fulcrum_match`, `fulcrum_track_record`.
- **Follow Up Boss** — push matched buyers + door-knock notes to the CRM:
  ```bash
  FULCRUM_API_URL=http://localhost:3011 pnpm --filter @fulcrum/integrations sync:fub <agentId>
  # dry-run unless FUB_API_KEY is set
  ```

## Roadmap
See FULCRUM_BUILD_PLAN.md. Phase 0 (ground-truth proof) is the gate —
if the seller model has no lift on one metro, stop.
