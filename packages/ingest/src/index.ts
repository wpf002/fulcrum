// Seller-side ingestion workers: county assessor/recorder, property-data
// feed, MLS/IDX where licensed, court records for the niche.
//
// Workers:
//  - tcad-travis.ts  — Travis County TCAD appraisal export -> Property +
//    SALE PropertyEvents, with (fips, apn) identity resolution and
//    quarantine (missing/duplicate apn, unusable situs address).
//  - load-scores.ts  — Phase 0 model scores (NDJSON) -> SellerScore rows
//    with Factor[] provenance.
//
// Rules:
//  - Every PropertyEvent must carry source provenance.
//  - Quarantined records are stored but never surfaced.
//  - On new events, enqueue affected propertyIds for ML rescoring (Phase 3).

export { PROP_FIELDS, parseLine } from "./layout.js";
