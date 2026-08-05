/**
 * Address → property identity resolution for the foreclosure feed.
 *
 * TCAD situs addresses are stored like "1711 CROWN DR" (house number + street +
 * abbreviated suffix, uppercase) with the zip in a separate column. Foreclosure
 * notices read "1711 Crown Drive, Austin, Texas 78745". We normalize both to
 * "<house#> <STREET NAME> <SUFFIX>" and require the house number and street name
 * to match (zip too, when the notice carries one); below that we quarantine —
 * a wrong match is worse than a miss.
 */

import { prisma } from "@fulcrum/db";

// USPS-ish suffix canonicalization (long/variant → the abbrev TCAD stores).
const SUFFIX: Record<string, string> = {
  DRIVE: "DR", DR: "DR", STREET: "ST", ST: "ST", ROAD: "RD", RD: "RD",
  LANE: "LN", LN: "LN", AVENUE: "AVE", AVE: "AVE", AV: "AVE",
  BOULEVARD: "BLVD", BLVD: "BLVD", COURT: "CT", CT: "CT", TRAIL: "TRL", TRL: "TRL",
  CIRCLE: "CIR", CIR: "CIR", WAY: "WAY", PATH: "PATH", COVE: "CV", CV: "CV",
  PASS: "PASS", LOOP: "LOOP", BEND: "BND", BND: "BND", PLACE: "PL", PL: "PL",
  TERRACE: "TER", TER: "TER", PARKWAY: "PKWY", PKWY: "PKWY", HIGHWAY: "HWY", HWY: "HWY",
  RUN: "RUN", ROW: "ROW", PLAZA: "PLZ", PLZ: "PLZ",
};
const DIRECTION: Record<string, string> = {
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W",
  N: "N", S: "S", E: "E", W: "W", NE: "NE", NW: "NW", SE: "SE", SW: "SW",
};

export interface NormalizedAddress {
  houseNumber: string;
  streetName: string; // canonical: "CROWN DR", "S 1 ST"
  full: string;
}

export function normalizeAddress(raw: string): NormalizedAddress | null {
  if (!raw) return null;
  // drop everything from the city/state onward, and unit markers
  let s = raw
    .toUpperCase()
    .replace(/,?\s*(AUSTIN|PFLUGERVILLE|DEL VALLE|MANOR|LAKEWAY|TEXAS|TX)\b[\s\S]*$/, "")
    .replace(/\b(?:UNIT|APT|STE|SUITE|#|BLDG|BUILDING)\s*[\w-]+/g, "")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const m = s.match(/^(\d+[A-Z]?)\s+(.+)$/);
  if (!m) return null;
  const houseNumber = m[1];
  const tokens = m[2].split(" ").filter(Boolean).map((t) => DIRECTION[t] ?? t);
  if (!tokens.length) return null;
  // canonicalize the trailing suffix if present
  const last = tokens[tokens.length - 1];
  if (SUFFIX[last]) tokens[tokens.length - 1] = SUFFIX[last];
  const streetName = tokens.join(" ");
  return { houseNumber, streetName, full: `${houseNumber} ${streetName}` };
}

export interface AddressMatch {
  propertyId: string;
  address: string;
  zip: string;
  confidence: number;
}

/**
 * Resolve a foreclosure address to a Travis property. Queries by house number,
 * then compares the normalized street name (and zip if the notice has one).
 */
export async function matchAddressToProperty(
  rawAddress: string,
  zip: string | null,
): Promise<AddressMatch | null> {
  const norm = normalizeAddress(rawAddress);
  if (!norm) return null;

  const candidates = await prisma.property.findMany({
    where: {
      resolutionStatus: "RESOLVED",
      addressLine1: { startsWith: `${norm.houseNumber} `, mode: "insensitive" },
      ...(zip ? { zip } : {}),
    },
    select: { id: true, addressLine1: true, zip: true },
    take: 50,
  });

  for (const c of candidates) {
    const cn = normalizeAddress(c.addressLine1);
    if (!cn) continue;
    if (cn.houseNumber === norm.houseNumber && cn.streetName === norm.streetName) {
      // exact house# + canonical street name (+ zip already filtered) = high
      return { propertyId: c.id, address: c.addressLine1, zip: c.zip, confidence: zip ? 1.0 : 0.9 };
    }
  }
  return null;
}
