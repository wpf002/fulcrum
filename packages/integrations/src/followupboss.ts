/**
 * Follow Up Boss integration (build plan §6 — "it's where agents live").
 *
 * Pushes a Fulcrum buyer + their matched likely-to-list homes into FUB as a
 * Person (with tags) + a Note (the door-knock list). Follow Up Boss auth is
 * HTTP Basic with the API key as the username and an empty password.
 *
 * Dry-run by default: with no FUB_API_KEY it logs the exact payloads instead of
 * sending — so the mapping is reviewable without live credentials.
 */

import type { Match } from "@fulcrum/client";

const FUB_BASE = "https://api.followupboss.com/v1";

export interface FubPerson {
  name: string;
  emails: { value: string }[];
  phones: { value: string }[];
  source: string;
  tags: string[];
}

export interface FubNote {
  subject: string;
  body: string;
}

function usd(cents: string | null): string {
  if (!cents) return "—";
  return `$${Math.round(Number(BigInt(cents) / 100n) / 1000)}K`;
}

/** Map a buyer's matches into a FUB Person + a door-knock Note. */
export function toFub(buyerMatches: Match[]): { person: FubPerson; note: FubNote } {
  const b = buyerMatches[0].buyer;
  const person: FubPerson = {
    name: b.name,
    emails: b.email ? [{ value: b.email }] : [],
    phones: b.phone ? [{ value: b.phone }] : [],
    source: "Fulcrum",
    tags: [
      "Fulcrum buyer",
      `readiness:${b.readinessScore}`,
      b.timelineMonths != null && b.timelineMonths <= 3 ? "timeline:hot" : "timeline:nurture",
    ],
  };

  const lines = buyerMatches
    .slice(0, 8)
    .map(
      (m) =>
        `• ${m.property.address} (${m.property.zip}) — match ${Math.round(m.matchScore * 100)}, ` +
        `${usd(m.property.avmEstimateCents)}, seller score ${m.property.sellerScore ?? "—"}` +
        `${m.property.eventTypes.includes("PROBATE") ? " [probate]" : ""}`,
    );
  const note: FubNote = {
    subject: `Fulcrum: ${buyerMatches.length} likely-to-list homes for ${b.name}`,
    body: `Warm buyer matched to homes where the owner is likely to list.\n\n${lines.join("\n")}`,
  };
  return { person, note };
}

export interface PushResult {
  buyer: string;
  personId: number | null;
  sent: boolean;
  dryRun: boolean;
}

async function fubPost(path: string, apiKey: string, body: unknown): Promise<Response> {
  const auth = Buffer.from(`${apiKey}:`).toString("base64");
  return fetch(`${FUB_BASE}${path}`, {
    method: "POST",
    headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Push one buyer's matches to FUB (or dry-run print). */
export async function pushBuyer(
  buyerMatches: Match[],
  opts: { apiKey?: string; log?: (s: string) => void } = {},
): Promise<PushResult> {
  const { person, note } = toFub(buyerMatches);
  const log = opts.log ?? console.log;

  if (!opts.apiKey) {
    log(`\n[DRY-RUN] FUB Person: ${JSON.stringify(person)}`);
    log(`[DRY-RUN] FUB Note:\n${note.subject}\n${note.body}`);
    return { buyer: person.name, personId: null, sent: false, dryRun: true };
  }

  const pRes = await fubPost("/people", opts.apiKey, person);
  if (!pRes.ok) throw new Error(`FUB /people → ${pRes.status}`);
  const created = (await pRes.json()) as { id: number };
  await fubPost("/notes", opts.apiKey, { personId: created.id, ...note });
  return { buyer: person.name, personId: created.id, sent: true, dryRun: false };
}
