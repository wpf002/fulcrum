// Shared types across api, web, widget, ingest, and the ml service contract.

export type FactorDirection = "up" | "down";

/** Every model output carries Factor[] provenance — scores explain themselves. */
export interface Factor {
  label: string; // e.g. "Tenure 9yr", "NOD filed", "Refi 8mo ago"
  weight: number;
  direction: FactorDirection;
}

/** Money is always integer cents. No floats for currency, anywhere. */
export interface Money {
  cents: bigint;
}

export interface ChannelOptIns {
  email: boolean;
  sms: boolean;
  tcpa: boolean;
}

/** Payload the embeddable widget POSTs to the api on tool completion. */
export interface BuyerLeadSubmission {
  agentId: string;
  source: string; // which widget/tool
  consent: {
    termsVersion: string;
    channelOptIns: ChannelOptIns;
  };
  contact?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
  };
  criteria?: {
    priceBandMinCents?: string; // BigInt serialized as string over the wire
    priceBandMaxCents?: string;
    targetGeographies?: string[];
    minBeds?: number;
    minBaths?: number;
    propertyType?: string;
    mustHaves?: Record<string, unknown>;
  };
  readiness?: {
    affordabilityResultCents?: string;
    mortgageReadinessAnswers?: Record<string, unknown>;
    timelineMonths?: number;
  };
}

// ── ml service contract (services/ml) ──

export interface SellerScoreRequest {
  propertyId: string;
}

export interface SellerScoreResponse {
  propertyId: string;
  probabilityListMonths: number;
  score: number; // 0–100
  velocity: number;
  factors: Factor[];
  modelVersion: string;
}

export interface MatchScoreRequest {
  buyerLeadId: string;
  propertyId: string;
}

export interface MatchScoreResponse {
  buyerLeadId: string;
  propertyId: string;
  matchScore: number; // criteriaFit × listLikelihood × buyerReadiness
  factors: Factor[];
}

// ── Redis stream names ──

export const STREAM_BUYER_LEADS = "buyer.leads";
export const STREAM_MATCH_REQUESTS = "match.requests";
