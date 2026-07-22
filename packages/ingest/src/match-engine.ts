/**
 * Match engine (Phase 4) — joins demand to supply inside one agent's book.
 *
 * For each active buyer lead: prefilter candidate properties by overlapping
 * geography + price band (keeps the scorer's input small), ask services/ml to
 * score the pairs (criteriaFit × listLikelihood × buyerReadiness), and write
 * ranked Match rows with Factor[] provenance.
 *
 * Triggers (build plan §5): new buyer lead, seller score crossing a threshold,
 * or a nightly batch. This worker runs the batch and also drains the
 * `buyer.leads` Redis stream via a consumer group (the Crossbar pattern), so a
 * freshly-captured lead is matched as soon as it lands.
 *
 * Usage:
 *   tsx src/match-engine.ts batch          # match every active lead
 *   tsx src/match-engine.ts consume        # XREADGROUP loop on buyer.leads
 */

import { prisma, Prisma, MatchStatus } from "@fulcrum/db";
import { redis } from "./redis.js";

const ML = process.env.ML_SERVICE_URL ?? "http://localhost:8000";
const STREAM = "buyer.leads";
const GROUP = "match-engine";
const CONSUMER = process.env.HOSTNAME ?? "match-1";
const CANDIDATE_LIMIT = 60;
const TOP_MATCHES_PER_LEAD = 12;
const MIN_MATCH_SCORE = 0.05; // below this it isn't worth surfacing

interface MlMatch {
  propertyId: string;
  buyerLeadId: string;
  matchScore: number;
  criteriaFit: number;
  listLikelihood: number;
  buyerReadiness: number;
  factors: Prisma.InputJsonValue;
}

/** Prefilter supply for a lead: resolved, scored, in target zips, within a
 *  padded price band. Returns candidate propertyIds ordered by list-likelihood. */
async function candidateProperties(lead: {
  targetGeographies: string[];
  priceBandMinCents: bigint | null;
  priceBandMaxCents: bigint | null;
}): Promise<string[]> {
  if (!lead.targetGeographies.length) return [];
  const pad = 15n; // percent padding so near-band homes still surface
  const lo = lead.priceBandMinCents ? (lead.priceBandMinCents * (100n - pad)) / 100n : 0n;
  const hi = lead.priceBandMaxCents
    ? (lead.priceBandMaxCents * (100n + pad)) / 100n
    : BigInt(Number.MAX_SAFE_INTEGER);

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT p.id
    FROM "Property" p
    JOIN LATERAL (
      SELECT "probabilityListMonths" FROM "SellerScore" s
      WHERE s."propertyId" = p.id ORDER BY s."computedAt" DESC LIMIT 1
    ) s ON true
    WHERE p."resolutionStatus" = 'RESOLVED'
      AND p.zip IN (${Prisma.join(lead.targetGeographies)})
      AND p."avmEstimateCents" BETWEEN ${lo} AND ${hi}
    ORDER BY s."probabilityListMonths" DESC
    LIMIT ${CANDIDATE_LIMIT}
  `;
  return rows.map((r) => r.id);
}

async function matchLead(leadId: string): Promise<number> {
  const lead = await prisma.buyerLead.findUnique({ where: { id: leadId } });
  if (!lead) return 0;

  const candidates = await candidateProperties(lead);
  if (!candidates.length) return 0;

  const res = await fetch(`${ML}/score/match`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ buyerLeadId: leadId, propertyIds: candidates }),
  });
  if (!res.ok) {
    console.warn(`  score/match failed for ${leadId}: ${res.status}`);
    return 0;
  }
  const { matches } = (await res.json()) as { matches: MlMatch[] };
  const top = matches.filter((m) => m.matchScore >= MIN_MATCH_SCORE).slice(0, TOP_MATCHES_PER_LEAD);

  let written = 0;
  for (const m of top) {
    // upsert on the unique (buyerLeadId, propertyId): refresh score/factors but
    // never clobber an agent's status action (CONTACTED/DISMISSED/CONVERTED).
    await prisma.match.upsert({
      where: { buyerLeadId_propertyId: { buyerLeadId: leadId, propertyId: m.propertyId } },
      create: {
        agentId: lead.agentId,
        buyerLeadId: leadId,
        propertyId: m.propertyId,
        matchScore: m.matchScore,
        factors: m.factors,
        status: MatchStatus.SURFACED,
      },
      update: { matchScore: m.matchScore, factors: m.factors },
    });
    written++;
  }
  return written;
}

async function runBatch() {
  const leads = await prisma.buyerLead.findMany({ select: { id: true, firstName: true } });
  console.log(`matching ${leads.length} active buyer leads...`);
  let total = 0;
  for (const l of leads) {
    const n = await matchLead(l.id);
    total += n;
    console.log(`  ${l.firstName ?? l.id}: ${n} matches`);
  }
  console.log(`\ndone: ${total} matches written`);
}

async function ensureGroup() {
  try {
    await redis.xgroup("CREATE", STREAM, GROUP, "0", "MKSTREAM");
  } catch (err) {
    if (!String(err).includes("BUSYGROUP")) throw err;
  }
}

async function runConsumer() {
  await ensureGroup();
  console.log(`consuming ${STREAM} as ${GROUP}/${CONSUMER} (Ctrl-C to stop)`);
  for (;;) {
    const resp = (await redis.xreadgroup(
      "GROUP", GROUP, CONSUMER, "COUNT", 10, "BLOCK", 5000, "STREAMS", STREAM, ">",
    )) as [string, [string, string[]][]][] | null;
    if (!resp) continue;
    for (const [, entries] of resp) {
      for (const [entryId, fields] of entries) {
        const idx = fields.indexOf("leadId");
        const leadId = idx > -1 ? fields[idx + 1] : null;
        if (leadId) {
          const n = await matchLead(leadId);
          console.log(`  lead ${leadId}: ${n} matches`);
        }
        await redis.xack(STREAM, GROUP, entryId);
      }
    }
  }
}

async function main() {
  const mode = process.argv[2] ?? "batch";
  if (mode === "consume") {
    await runConsumer();
  } else {
    await runBatch();
    await redis.quit();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
