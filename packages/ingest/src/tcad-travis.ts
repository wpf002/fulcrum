/**
 * Travis County (FIPS 48453) seller-side ingest worker.
 *
 * Streams PROP.TXT out of a TCAD certified appraisal export zip
 * (deflate64 — Node's zlib can't read it, so we shell out to `unzip -p`),
 * normalizes each record, runs identity resolution, and loads:
 *   - Property rows (deterministic ids: trav-<prop_id>)
 *   - PropertyEvent SALE rows from deed dates (provenance mandatory)
 *
 * Identity resolution (per FULCRUM_BUILD_PLAN.md §3):
 *   - deterministic key = (fips, apn) where apn = TCAD geo_id
 *   - records with a missing apn, a duplicate apn, or no usable situs
 *     address are QUARANTINED — stored but never surfaced. Bad matches
 *     destroy agent trust faster than anything; err toward withholding.
 *
 * Usage: tsx src/tcad-travis.ts <export.zip> <member> [--limit N]
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { prisma, Prisma, ResolutionStatus, OwnerType, PropertyEventType } from "@fulcrum/db";
import { PROP_FIELDS, parseLine } from "./layout.js";

const FIPS = "48453";
const SOURCE = "tcad-certified-export";
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

async function main() {
  const [zipPath, member] = process.argv.slice(2);
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;
  if (!zipPath || !member) {
    console.error("usage: tsx src/tcad-travis.ts <export.zip> <member> [--limit N]");
    process.exit(1);
  }

  const asOf = new Date();
  const seenApns = new Set<string>();
  const seenPropIds = new Set<string>();

  let props: Prisma.PropertyCreateManyInput[] = [];
  let events: Prisma.PropertyEventCreateManyInput[] = [];
  const stats = { read: 0, real: 0, loaded: 0, quarantined: 0, events: 0 };

  async function flush() {
    if (props.length) {
      const r = await prisma.property.createMany({ data: props, skipDuplicates: true });
      stats.loaded += r.count;
      props = [];
    }
    if (events.length) {
      const r = await prisma.propertyEvent.createMany({ data: events, skipDuplicates: true });
      stats.events += r.count;
      events = [];
    }
  }

  const proc = spawn("unzip", ["-p", zipPath, member], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });

  for await (const line of rl) {
    stats.read++;
    if (stats.read > limit) break;
    const rec = parseLine(line, PROP_FIELDS);
    if (rec.propTypeCd !== "R") continue;
    if (seenPropIds.has(rec.propId)) continue; // partial-owner duplicate rows
    seenPropIds.add(rec.propId);
    stats.real++;

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
      // duplicate/blank apns can't share the (fips, apn) unique key —
      // quarantined rows get a synthetic apn and are never surfaced.
      storedApn = `QUAR-${rec.propId}`;
      stats.quarantined++;
    } else {
      seenApns.add(apn);
    }

    const deedDate = parseDeedDate(rec.deedDt);
    const isEntity = ENTITY_RE.test(rec.ownerName.toUpperCase());
    const absentee = rec.ownerZip && rec.situsZip ? rec.ownerZip !== rec.situsZip.slice(0, 5) : false;
    const ownerType = isEntity
      ? OwnerType.ENTITY
      : absentee
        ? OwnerType.ABSENTEE
        : OwnerType.OWNER_OCCUPIED;

    const id = `trav-${rec.propId}`;
    props.push({
      id,
      apn: storedApn,
      fips: FIPS,
      addressLine1: situsLine || "UNKNOWN",
      city: rec.situsCity || "AUSTIN",
      state: "TX",
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
        source: `${SOURCE}:${member}`,
        sourceRef: [rec.deedBookId, rec.deedBookPage].filter(Boolean).join("/") || null,
        payload: rec.mortgageCoName ? { mortgageCo: rec.mortgageCoName } : undefined,
      });
    }

    if (props.length >= BATCH) await flush();
    if (stats.real % 50000 === 0) console.log(`...${stats.real} properties processed`);
  }
  await flush();

  console.log(
    `done: read=${stats.read} real=${stats.real} loaded=${stats.loaded} ` +
      `quarantined=${stats.quarantined} saleEvents=${stats.events}`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
