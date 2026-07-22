/**
 * Decedent → property identity resolution.
 *
 * The genuine value-add of the probate feed: a filing names a decedent; we must
 * find the Travis property that decedent owned. TCAD stores owner names roughly
 * "LAST FIRST MIDDLE" (e.g. "WEBER FRED O"); court filings read "First Middle
 * Last" or "Estate of First Last". We match on the SET of significant name
 * tokens (order-independent), require both a surname and a given-name hit, and
 * quarantine anything below threshold — a wrong match is worse than a miss
 * (build plan §3: err toward withholding).
 *
 * Probate is an individual-owner event, so entity-owned parcels are excluded.
 */

import { prisma } from "@fulcrum/db";

const SUFFIXES = new Set(["JR", "SR", "II", "III", "IV", "V"]);
const NOISE = new Set(["ESTATE", "OF", "THE", "DECEASED", "DECD", "ETAL", "ET", "AL", "AKA", "DBA"]);

export interface NormalizedName {
  tokens: string[]; // significant tokens, deduped
  surname: string | null; // best-guess last name
  given: string | null; // best-guess first name
}

export function normalizeName(raw: string): NormalizedName {
  const cleaned = (raw || "")
    .toUpperCase()
    .replace(/[.,]/g, " ")
    .replace(/&/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const all = cleaned.split(" ").filter((t) => t && !NOISE.has(t) && !SUFFIXES.has(t) && t.length > 1);
  const tokens = [...new Set(all)];
  // court order "First Last" → surname is last token; TCAD "Last First" → first
  // token. We keep both candidates via the token set and pick surname as the
  // longest token as a stable tiebreak, but matching is order-independent.
  return {
    tokens,
    surname: all.length ? all[all.length - 1] : null,
    given: all.length ? all[0] : null,
  };
}

export interface DecedentMatch {
  propertyId: string;
  ownerName: string;
  confidence: number; // 0..1
}

/** Token overlap (Jaccard) between two name token sets. */
function overlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const bs = new Set(b);
  const inter = a.filter((t) => bs.has(t)).length;
  return inter / new Set([...a, ...b]).size;
}

/**
 * Find the best individually-owned Travis property matching a decedent name.
 * Returns null below the confidence threshold (quarantine).
 */
export async function matchDecedentToProperty(
  decedentName: string,
  opts: { minConfidence?: number } = {},
): Promise<DecedentMatch | null> {
  const min = opts.minConfidence ?? 0.5;
  const norm = normalizeName(decedentName);
  if (!norm.surname || norm.tokens.length < 2) return null;

  // candidate set: individually-owned, resolved properties whose owner name
  // contains the surname. (Narrow query, then score precisely in JS.)
  const candidates = await prisma.property.findMany({
    where: {
      resolutionStatus: "RESOLVED",
      ownerType: { not: "ENTITY" },
      ownerName: { contains: norm.surname, mode: "insensitive" },
    },
    select: { id: true, ownerName: true },
    take: 200,
  });

  let best: DecedentMatch | null = null;
  for (const c of candidates) {
    if (!c.ownerName) continue;
    const cn = normalizeName(c.ownerName);
    // require both a surname and at least one other given-name token to match
    const sharesSurname = cn.tokens.includes(norm.surname);
    const sharedGiven = norm.tokens.filter((t) => t !== norm.surname && cn.tokens.includes(t)).length;
    if (!sharesSurname || sharedGiven < 1) continue;
    const confidence = overlap(norm.tokens, cn.tokens);
    if (confidence >= min && (!best || confidence > best.confidence)) {
      best = { propertyId: c.id, ownerName: c.ownerName, confidence: Number(confidence.toFixed(3)) };
    }
  }
  return best;
}
