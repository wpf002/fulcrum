# fulcrum-ml — seller model service (Phase 3)

Serves the LightGBM seller model behind FastAPI and scores properties on
demand, layering explainable **event priors** (probate, pre-foreclosure, …)
on top of the base model. This is the rescore-on-event engine.

## Endpoints
- `GET /health` — model version + holdout lift
- `POST /score/seller` `{ "propertyId": "trav-..." }` — reads the property +
  its events from Postgres and returns `{ probability, base_probability,
  score (0–100), velocity, factors[], modelVersion }`. The caller persists the
  `SellerScore` (single Prisma writer).
- `POST /score/match` — Phase 4 stub.

## Scoring model
- **Base signal.** If the property already has a score (the richer Phase 0
  model, loaded in Phase 1) that probability is the base and its factors are
  kept. Otherwise the property is cold-scored with the servable LightGBM model
  (`seller-serving-v2`), trained on features reconstructable at serving time
  from `Property` (tenure, entity/absentee, market value, zip). Holdout lift
  ~1.85× — close to the 1.97× Phase 0 proof despite far fewer features; the
  richer features (neighborhood turnover, value trajectory) are a Phase 6
  feature-store task.
- **Event priors** (`features.py:EVENT_PRIORS`). No probate/NOD labels exist
  yet, so their weights can't be learned by the base model; they're encoded as
  explainable odds multipliers that decay with event age. Phase 5's outcome
  loop learns the true weights once tracked sales accumulate.
- `velocity` = the event-driven delta (final − base), in score points.

## Run locally
```bash
# 1. train the servable model (needs the Phase 0 dataset.parquet)
python train_serving.py <phase0_dataset.parquet> models
# 2. serve
DATABASE_URL=postgresql://fulcrum:fulcrum@localhost:5437/fulcrum \
  uvicorn main:app --host 127.0.0.1 --port 8010
# 3. drive the probate feed + rescore pipeline
ML_SERVICE_URL=http://127.0.0.1:8010 REDIS_URL=redis://localhost:6380 \
  pnpm --filter @fulcrum/ingest ingest:probate --limit 15
```

The trained model (`models/seller_serving.txt`, ~4MB) and its
`feature_meta.json` (feature order + zip vocab) are committed so the service
runs from a clone; regenerate them with `train_serving.py` when the model
changes.
