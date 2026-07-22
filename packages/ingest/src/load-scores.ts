/**
 * Load Phase 0 model scores (NDJSON.gz from notebooks/phase0/score_current.py)
 * into SellerScore rows. Properties were ingested with deterministic ids
 * (trav-<prop_id>), so this is a straight keyed load — no lookups.
 *
 * Usage: tsx src/load-scores.ts <scores.ndjson.gz>
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { prisma, Prisma } from "@fulcrum/db";

const BATCH = 5000;
// Phase 0 model horizon: trained on "market sale within 24 months".
const HORIZON_MONTHS = 24;

async function main() {
  const [path] = process.argv.slice(2);
  if (!path) {
    console.error("usage: tsx src/load-scores.ts <scores.ndjson.gz>");
    process.exit(1);
  }

  // scores reference properties by deterministic id — collect the ones that
  // exist so quarantined/missing rows don't fail the FK.
  const existing = new Set(
    (await prisma.property.findMany({ select: { id: true } })).map((p) => p.id),
  );
  console.log(`${existing.size} properties in db`);

  const rl = createInterface({
    input: createReadStream(path).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  let batch: Prisma.SellerScoreCreateManyInput[] = [];
  const stats = { read: 0, loaded: 0, skipped: 0 };

  async function flush() {
    if (!batch.length) return;
    const r = await prisma.sellerScore.createMany({ data: batch });
    stats.loaded += r.count;
    batch = [];
  }

  for await (const line of rl) {
    if (!line.trim()) continue;
    stats.read++;
    const rec = JSON.parse(line) as {
      prop_id: string;
      probability: number;
      score: number;
      factors: unknown[];
      model_version: string;
    };
    const propertyId = `trav-${rec.prop_id}`;
    if (!existing.has(propertyId)) {
      stats.skipped++;
      continue;
    }
    batch.push({
      propertyId,
      probabilityListMonths: rec.probability,
      score: rec.score,
      velocity: 0, // first score — no trailing window yet
      factors: rec.factors as Prisma.InputJsonValue,
      modelVersion: `${rec.model_version}:h${HORIZON_MONTHS}mo`,
    });
    if (batch.length >= BATCH) await flush();
  }
  await flush();

  console.log(`done: read=${stats.read} loaded=${stats.loaded} skipped=${stats.skipped}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
