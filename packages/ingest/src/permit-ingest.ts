/**
 * Austin construction-permit ingest → rescore (PERMIT signal).
 *
 * Free City of Austin open data (no key, robots-permitted). Permits carry
 * `tcad_id`, which joins exactly to Property.apn — the only event feed with a
 * deterministic join, so nothing is fuzzy-matched or quarantined for identity.
 *
 * Only residential permits that classify as a real signal are recorded:
 * pre-sale prep work (mild positive) or major investment (argues against a
 * near-term sale). Neutral permits are counted and skipped.
 *
 * Usage:
 *   tsx src/permit-ingest.ts [--zips 78704,78745] [--since 2026-01-01] [--limit 2000]
 */

import { prisma, PropertyEventType } from "@fulcrum/db";
import { redis } from "./redis.js";
import { fetchPermits } from "./permits/fetch.js";
import { classifyPermit, permitLabel } from "./permits/classify.js";
import { enqueueRescore, drainAndRescore } from "./events/rescore.js";

const SOURCE = "data.austintexas.gov:issued-construction-permits";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const zips = (arg("--zips") ?? "78704,78745,78748,78749").split(",").map((z) => z.trim());
  const since = arg("--since") ?? "2026-01-01";
  const limit = Number(arg("--limit") ?? 2000);

  console.log(`fetching Austin permits · zips ${zips.join(",")} · since ${since}`);
  const permits = await fetchPermits({ zips, since, limit });
  console.log(`fetched ${permits.length} permits`);

  const stats = { prep: 0, investment: 0, neutral: 0, unmatched: 0, events: 0, dupe: 0 };
  const affected = new Set<string>();

  for (const p of permits) {
    const signal = classifyPermit(p);
    if (signal === "neutral") { stats.neutral++; continue; }
    if (!p.tcad_id) { stats.unmatched++; continue; }

    // deterministic join: permit tcad_id === Property.apn
    const property = await prisma.property.findFirst({
      where: { apn: p.tcad_id, fips: "48453", resolutionStatus: "RESOLVED" },
      select: { id: true },
    });
    if (!property) { stats.unmatched++; continue; }

    const ref = p.permit_number ?? null;
    if (ref) {
      const seen = await prisma.propertyEvent.findFirst({
        where: { propertyId: property.id, sourceRef: ref, type: PropertyEventType.PERMIT },
        select: { id: true },
      });
      if (seen) { stats.dupe++; continue; }
    }

    await prisma.propertyEvent.create({
      data: {
        propertyId: property.id,
        type: PropertyEventType.PERMIT,
        occurredAt: p.issue_date ? new Date(p.issue_date) : new Date(),
        source: SOURCE,
        sourceRef: ref,
        payload: {
          signal,
          label: permitLabel(signal, p),
          workClass: p.work_class ?? null,
          permitType: p.permit_type_desc ?? null,
          address: p.original_address1 ?? null,
          description: (p.description ?? "").slice(0, 200) || null,
        },
      },
    });
    signal === "prep" ? stats.prep++ : stats.investment++;
    stats.events++;
    affected.add(property.id);
  }

  console.log(
    `\nprep ${stats.prep} · investment ${stats.investment} · neutral(skipped) ${stats.neutral} · ` +
      `already-recorded ${stats.dupe} · no property match ${stats.unmatched}`,
  );
  console.log(`${stats.events} PERMIT events across ${affected.size} properties`);

  await enqueueRescore(affected, "PERMIT");
  const rescored = await drainAndRescore();
  console.log(`\ndone: ${stats.events} events, ${rescored} rescored`);

  await redis.quit();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
