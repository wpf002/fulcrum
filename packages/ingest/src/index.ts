// Seller-side ingestion workers: county assessor/recorder, property-data
// feed, MLS/IDX where licensed, court records for the niche.
//
// Workers:
//  - ingest-cli.ts   — county-dispatch appraisal ingest (see counties/). Any
//    metro is a registry entry; same-format counties reuse one reader.
//  - load-scores.ts  — Phase 0 model scores (NDJSON) -> SellerScore rows.
//  - probate-travis.ts — probate event feed + rescore-on-event pipeline.
//  - match-engine.ts / load-outcomes.ts — Phase 4 / Phase 5 workers.
//
// Rules:
//  - Every PropertyEvent must carry source provenance.
//  - Quarantined records are stored but never surfaced.
//  - On new events, enqueue affected propertyIds for ML rescoring (Phase 3).

export { PROP_FIELDS, parseLine } from "./layout.js";
