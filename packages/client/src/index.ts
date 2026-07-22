/**
 * @fulcrum/client — typed API client.
 *
 * One place other projects, the MCP tools, and CRM integrations consume
 * Fulcrum scores + matches, instead of hand-rolling fetch calls. Publish to a
 * private registry (Verdaccio) if/when external consumers need it (build plan
 * §6) — the package is registry-ready but intentionally not published here.
 */

export interface Factor {
  label: string;
  weight: number;
  direction: "up" | "down";
}

export interface PropertyScore {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  ownerName: string | null;
  ownerType: string | null;
  ownershipTenureMonths: number | null;
  avmEstimateCents: string | null;
  resolutionStatus: string;
  score: number | null;
  probabilityListMonths: number | null;
  velocity: number | null;
  factors: Factor[];
  modelVersion: string | null;
  events: { type: string; occurredAt: string }[];
}

export interface Agent {
  id: string;
  name: string;
  email?: string;
  territories?: { zips?: string[] };
}

export interface Match {
  id: string;
  matchScore: number;
  status: string;
  factors: Factor[];
  buyer: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    readinessScore: number;
    priceBandMinCents: string | null;
    priceBandMaxCents: string | null;
    timelineMonths: number | null;
  };
  property: {
    id: string;
    address: string;
    zip: string;
    ownerName: string | null;
    ownerType: string | null;
    avmEstimateCents: string | null;
    sellerScore: number | null;
    eventTypes: string[];
  };
}

export interface TrackRecord {
  track: Record<string, unknown> | null;
  latestRetrain: Record<string, unknown> | null;
  db: {
    confirmedSales: number;
    viaTrackedBuyer: number;
    recent: unknown[];
  };
}

export class FulcrumClient {
  constructor(
    private baseUrl = process.env.FULCRUM_API_URL ?? "http://localhost:3011",
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`);
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
    return (await res.json()) as T;
  }

  health(): Promise<{ ok: boolean; service: string }> {
    return this.get("/health");
  }

  listAgents(): Promise<Agent[]> {
    return this.get("/v1/agents");
  }

  /** Latest list-likelihood score + explanations for one property. */
  propertyScore(propertyId: string): Promise<PropertyScore> {
    return this.get(`/v1/properties/${encodeURIComponent(propertyId)}`);
  }

  /** Top scored properties in a territory (zip list). */
  territory(zips: string[], limit = 50): Promise<PropertyScore[]> {
    return this.get(`/v1/properties?zips=${zips.join(",")}&limit=${limit}`);
  }

  /** Ranked buyer↔home matches for an agent. */
  matches(agentId: string): Promise<Match[]> {
    return this.get(`/v1/agents/${encodeURIComponent(agentId)}/matches`);
  }

  trackRecord(): Promise<TrackRecord> {
    return this.get("/v1/model/track-record");
  }
}
