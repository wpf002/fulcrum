// Seller-side ingestion workers (Phase 1+): county assessor/recorder,
// property-data feed, MLS/IDX where licensed, court records for the niche.
//
// Rules:
//  - Normalize addresses, then identity-resolve: deterministic join on
//    (fips, apn) where a parcel id exists; probabilistic fallback on
//    normalized address + ownerName with a confidence threshold. Below
//    threshold -> Property.resolutionStatus = QUARANTINED, never surfaced.
//  - Every PropertyEvent must carry source provenance.
//  - On new events, enqueue affected propertyIds for ML rescoring.

export {};
