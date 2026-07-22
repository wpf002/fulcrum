/**
 * Outcome loader (Phase 5) — closes the training loop.
 *
 * Reads confirmed sales (services/ml/build_outcomes.py output: real 2024→2025
 * deed transfers) and writes, for each:
 *   - a backdated SellerScore = the 2024 PREDICTION being validated
 *   - an Outcome tied to that prediction (predictedSellerScoreId), with the
 *     real sale date; viaTrackedBuyer flagged when a Fulcrum funnel buyer was
 *     matched to the property (the buyer-side confirmation SmartZip can't do)
 *
 * Sale PRICE isn't public in Texas (non-disclosure), so salePriceCents records
 * the AVM estimate as a documented proxy; the outcome/label and timing are real.
 *
 * Usage: tsx src/load-outcomes.ts <outcomes_sold.csv>
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { prisma, Prisma } from "@fulcrum/db";

const PRED_MODEL = "seller-serving-v2@2024-cohort";
const SNAPSHOT_2024 = new Date("2024-08-21T00:00:00Z");
const SOURCE = "county-recorder-deed (TX non-disclosure: price=AVM proxy)";

async function main() {
  const [csvPath] = process.argv.slice(2);
  if (!csvPath) {
    console.error("usage: tsx src/load-outcomes.ts <outcomes_sold.csv>");
    process.exit(1);
  }

  // read confirmed sales
  const rl = createInterface({ input: createReadStream(csvPath), crlfDelay: Infinity });
  const sold: { propId: string; predProb: number; soldDate: string; days: number; score: number }[] = [];
  let header: string[] | null = null;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const parts = line.split(",");
    if (!header) {
      header = parts;
      continue;
    }
    const rec = Object.fromEntries(header.map((h, i) => [h, parts[i]]));
    sold.push({
      propId: rec.prop_id,
      predProb: Number(rec.pred_prob),
      soldDate: rec.sold_date,
      days: Number(rec.days_to_sale),
      score: Number(rec.score),
    });
  }
  console.log(`confirmed sales in file: ${sold.length}`);

  const ids = sold.map((s) => `trav-${s.propId}`);

  // prefetch: which properties exist (+ AVM for the price proxy)
  const props = await prisma.property.findMany({
    where: { id: { in: ids } },
    select: { id: true, avmEstimateCents: true },
  });
  const avm = new Map(props.map((p) => [p.id, p.avmEstimateCents]));

  // prefetch: matched properties → a tracked buyer lead (the moat signal)
  const matches = await prisma.match.findMany({
    where: { propertyId: { in: ids } },
    select: { propertyId: true, buyerLeadId: true },
  });
  const trackedBuyer = new Map(matches.map((m) => [m.propertyId, m.buyerLeadId]));

  const scoreRows: Prisma.SellerScoreCreateManyInput[] = [];
  const outcomeRows: Prisma.OutcomeCreateManyInput[] = [];
  let viaBuyer = 0;

  for (const s of sold) {
    const propertyId = `trav-${s.propId}`;
    if (!avm.has(propertyId)) continue;
    const predId = `pred2024-${s.propId}`;
    scoreRows.push({
      id: predId,
      propertyId,
      probabilityListMonths: s.predProb,
      score: s.score,
      velocity: 0,
      factors: [{ label: "2024 prediction (validated by sale)", weight: s.predProb, direction: "up" }],
      modelVersion: PRED_MODEL,
      computedAt: SNAPSHOT_2024,
    });
    const buyerLeadId = trackedBuyer.get(propertyId) ?? null;
    if (buyerLeadId) viaBuyer++;
    outcomeRows.push({
      id: `out-${s.propId}`,
      propertyId,
      soldAt: new Date(`${s.soldDate}T00:00:00Z`),
      salePriceCents: avm.get(propertyId) ?? 0n,
      source: SOURCE,
      viaTrackedBuyer: Boolean(buyerLeadId),
      trackedBuyerLeadId: buyerLeadId,
      predictedSellerScoreId: predId,
    });
  }

  // clear any prior run so the loop is idempotent
  await prisma.outcome.deleteMany({ where: { id: { in: outcomeRows.map((o) => o.id!) } } });
  await prisma.sellerScore.deleteMany({ where: { id: { in: scoreRows.map((r) => r.id!) } } });

  const s1 = await prisma.sellerScore.createMany({ data: scoreRows, skipDuplicates: true });
  const s2 = await prisma.outcome.createMany({ data: outcomeRows, skipDuplicates: true });

  console.log(
    `wrote ${s1.count} backdated predictions + ${s2.count} outcomes; ` +
      `${viaBuyer} closed via a tracked funnel buyer`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
