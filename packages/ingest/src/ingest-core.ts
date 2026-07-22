/**
 * County-agnostic ingest core. Given a county config + a format reader, it
 * normalizes records, runs identity resolution, and loads Property +
 * SALE PropertyEvent rows. All the per-county variation lives in the registry
 * and the format reader; this logic is shared across every metro.
 *
 * Identity resolution (build plan §3): deterministic key (fips, apn); records
 * with a missing/duplicate apn or no usable situs address are QUARANTINED —
 * stored but never surfaced.
 */

import { prisma, Prisma, ResolutionStatus, OwnerType, PropertyEventType } from "@fulcrum/db";
import type { CountyConfig } from "./counties/registry.js";
import { READERS } from "./counties/pacs.js";

const BATCH = 2000;
const ENTITY_RE =
  /\b(LLC|L L C|LP|LLP|LTD|INC|CORP|TRUST|TR|PARTNERS|PARTNERSHIP|HOLDINGS|PROPERTIES|INVESTMENTS?|VENTURES?|HOMES|GROUP|FUND|CHURCH|CITY OF|COUNTY|AUTHORITY|FOUNDATION|ASSN|ASSOCIATION)\b/;

function parseDeedDate(s: string): Date | null {
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/) ?? s.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])));
  return isNaN(d.getTime()) ? null : d;
}

function toCents(raw: string): bigint | null {
  const n = Number(raw);
  if (!raw || isNaN(n) || n <= 0) return null;
  return BigInt(Math.round(n)) * 100n;
}

function monthsBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((a.getTime() - b.getTime()) / (30.44 * 86400e3)));
}

export interface IngestStats {
  read: number;
  loaded: number;
  quarantined: number;
  events: number;
}

export async function ingestCounty(
  county: CountyConfig,
  zipPath: string,
  member: string,
  opts: { limit?: number } = {},
): Promise<IngestStats> {
  const limit = opts.limit ?? Infinity;
  const reader = READERS[county.format];
  const asOf = new Date();
  const seenApns = new Set<string>();

  let props: Prisma.PropertyCreateManyInput[] = [];
  let events: Prisma.PropertyEventCreateManyInput[] = [];
  const stats: IngestStats = { read: 0, loaded: 0, quarantined: 0, events: 0 };

  async function flush() {
    if (props.length) {
      stats.loaded += (await prisma.property.createMany({ data: props, skipDuplicates: true })).count;
      props = [];
    }
    if (events.length) {
      stats.events += (await prisma.propertyEvent.createMany({ data: events, skipDuplicates: true })).count;
      events = [];
    }
  }

  for await (const rec of reader.streamRecords(zipPath, member)) {
    stats.read++;
    if (stats.read > limit) break;

    // ── identity resolution ──
    const apn = rec.geoId;
    const situsLine = [rec.situsNum, rec.situsStreetPrefix, rec.situsStreet, rec.situsStreetSuffix, rec.situsUnit]
      .filter(Boolean)
      .join(" ");
    let status: ResolutionStatus = ResolutionStatus.RESOLVED;
    let confidence: number | null = 1.0;
    let storedApn = apn;
    if (!apn || seenApns.has(apn) || !rec.situsStreet || !rec.situsNum) {
      status = ResolutionStatus.QUARANTINED;
      confidence = 0;
      storedApn = `QUAR-${rec.propId}`;
      stats.quarantined++;
    } else {
      seenApns.add(apn);
    }

    const deedDate = parseDeedDate(rec.deedDt);
    const isEntity = ENTITY_RE.test((rec.ownerName ?? "").toUpperCase());
    const absentee = rec.ownerZip && rec.situsZip ? rec.ownerZip !== rec.situsZip.slice(0, 5) : false;
    const ownerType = isEntity ? OwnerType.ENTITY : absentee ? OwnerType.ABSENTEE : OwnerType.OWNER_OCCUPIED;

    const id = `${county.idPrefix}-${rec.propId}`;
    props.push({
      id,
      apn: storedApn,
      fips: county.fips,
      addressLine1: situsLine || "UNKNOWN",
      city: rec.situsCity || county.defaultCity,
      state: county.state,
      zip: rec.situsZip.slice(0, 5) || "00000",
      propertyType: rec.imprvStateCd || null,
      ownerName: rec.ownerName || null,
      ownerType,
      lastSaleDate: deedDate,
      ownershipTenureMonths: deedDate ? monthsBetween(asOf, deedDate) : null,
      assessedValueCents: toCents(rec.assessedVal),
      avmEstimateCents: toCents(rec.marketValue),
      resolutionStatus: status,
      resolutionConfidence: confidence,
    });

    if (deedDate) {
      events.push({
        propertyId: id,
        type: PropertyEventType.SALE,
        occurredAt: deedDate,
        source: `${county.sourceName}:${member}`,
        sourceRef: [rec.deedBookId, rec.deedBookPage].filter(Boolean).join("/") || null,
        payload: rec.mortgageCoName ? { mortgageCo: rec.mortgageCoName } : undefined,
      });
    }

    if (props.length >= BATCH) await flush();
    if (stats.read % 50000 === 0) console.log(`...${stats.read} properties processed`);
  }
  await flush();
  return stats;
}
