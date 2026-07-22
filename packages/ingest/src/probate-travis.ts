/**
 * Travis County probate event feed + rescore-on-event pipeline (Phase 3).
 *
 * Probate is the cleanest niche wedge: a long-tenure owner-occupant dies, the
 * estate files probate, and the home very often lists within a year. This is
 * exactly the individual-owner signal the Phase 0 appraisal model was weak on.
 *
 * PIPELINE (build plan §4/§6): ingest enqueues → ml scores → write SellerScore.
 *   1. select probate-profile properties, insert PROBATE PropertyEvents
 *   2. publish affected propertyIds to the Redis `score.requests` stream
 *   3. drain the stream, call services/ml /score/seller, write the refreshed
 *      SellerScore (probability, score, velocity, Factor[]) via Prisma
 *
 * NOTE ON DATA: Travis County probate filings aren't bulk-downloadable — the
 * per-county court scraper is the Phase 6 "templatize per county" grind. This
 * worker SYNTHESIZES a realistic probate feed over the correct property profile
 * (long-tenure owner-occupied homes) so the pipeline is exercised end to end.
 * The provenance below marks it as a stand-in source, not real court data.
 */

import { prisma, PropertyEventType, Prisma } from "@fulcrum/db";
import { redis } from "./redis.js";

const STREAM = "score.requests";
const SOURCE = "SYNTHETIC:travis-county-probate-court";
const ML = process.env.ML_SERVICE_URL ?? "http://localhost:8000";
const FARM_ZIPS = ["78704", "78745", "78748", "78749"];

interface ScoreResult {
  probability: number;
  base_probability: number;
  score: number;
  velocity: number;
  factors: Prisma.InputJsonValue;
  modelVersion: string;
}

function caseNo(i: number): string {
  return `C-1-PB-25-${String(100000 + i).slice(1)}`;
}

async function main() {
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 15;

  // 1 ── probate-profile properties: long-tenure owner-occupants ──
  const candidates = await prisma.property.findMany({
    where: {
      resolutionStatus: "RESOLVED",
      ownerType: "OWNER_OCCUPIED",
      zip: { in: FARM_ZIPS },
      ownershipTenureMonths: { gte: 300 }, // 25+ years owned
    },
    orderBy: { ownershipTenureMonths: "desc" },
    take: limit,
  });
  console.log(`probate-profile candidates: ${candidates.length}`);

  // 2 ── insert PROBATE events + enqueue for rescoring ──
  const now = Date.now();
  let enqueued = 0;
  for (let i = 0; i < candidates.length; i++) {
    const p = candidates[i];
    const daysAgo = 5 + Math.floor(Math.random() * 55); // filed in last ~2 months
    const occurredAt = new Date(now - daysAgo * 86400e3);
    await prisma.propertyEvent.create({
      data: {
        propertyId: p.id,
        type: PropertyEventType.PROBATE,
        occurredAt,
        source: SOURCE,
        sourceRef: caseNo(i),
        payload: {
          decedentOwner: p.ownerName,
          court: "Travis County Probate Court No. 1",
          note: "synthesized stand-in for county probate scraper",
        },
      },
    });
    await redis.xadd(STREAM, "*", "propertyId", p.id, "reason", "PROBATE");
    enqueued++;
  }
  console.log(`inserted ${enqueued} PROBATE events, enqueued to ${STREAM}`);

  // 3 ── drain the queue: score via ml, write refreshed SellerScore ──
  const pending = await redis.xrange(STREAM, "-", "+");
  let rescored = 0;
  for (const [entryId, fields] of pending) {
    const idx = fields.indexOf("propertyId");
    const propertyId = idx > -1 ? fields[idx + 1] : null;
    if (!propertyId) continue;

    const res = await fetch(`${ML}/score/seller`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ propertyId }),
    });
    if (!res.ok) {
      console.warn(`  score failed for ${propertyId}: ${res.status}`);
      continue;
    }
    const r = (await res.json()) as ScoreResult;
    await prisma.sellerScore.create({
      data: {
        propertyId,
        probabilityListMonths: r.probability,
        score: r.score,
        velocity: r.velocity,
        factors: r.factors,
        modelVersion: r.modelVersion,
      },
    });
    await redis.xdel(STREAM, entryId);
    rescored++;
    console.log(
      `  rescored ${propertyId}: score ${r.score} (base ${Math.round(
        r.base_probability * 100,
      )} → +${r.velocity}) ${r.modelVersion}`,
    );
  }

  console.log(`\ndone: ${enqueued} events, ${rescored} rescored`);
  await redis.quit();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
