/**
 * Travis County probate ingest + rescore-on-event (real-source wiring).
 *
 * Replaces the earlier synthesized feed. Pulls real probate filings from a
 * LICENSED source (UniCourt LDaaS if UNICOURT_API_KEY is set, otherwise a real
 * export file), resolves each decedent to the Travis property they owned, and —
 * only for confident matches — writes a PROBATE PropertyEvent with real
 * provenance (cause number, decedent, filing date, source). Then the existing
 * pipeline runs: enqueue affected properties → ml scores → write SellerScore.
 *
 * Access note: there is no free unauthenticated Travis probate feed — the
 * Odyssey portal is reCAPTCHA + WAF protected and its Terms forbid scraping, so
 * we do NOT scrape it. See ./probate/README.md.
 *
 * Usage:
 *   tsx src/probate-ingest.ts --file <export.csv|json> [--since YYYY-MM-DD]
 *                             [--limit N] [--min-confidence 0.5]
 *   (or set UNICOURT_API_KEY to pull from UniCourt LDaaS)
 */

import { prisma, PropertyEventType, Prisma } from "@fulcrum/db";
import { redis } from "./redis.js";
import type { ProbateFiling, ProbateSource } from "./probate/types.js";
import { uniCourtSource } from "./probate/sources/unicourt.js";
import { exportFileSource } from "./probate/sources/export-file.js";
import { publicNoticeFromFile, publicNoticeLive } from "./probate/sources/public-notice.js";
import { matchDecedentToProperty } from "./probate/match.js";

const STREAM = "score.requests";
const ML = process.env.ML_SERVICE_URL ?? "http://localhost:8000";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function selectSource(): ProbateSource {
  // free: Texas public "Notice to Creditors" — a saved results page, or live
  const notices = arg("--notices-file");
  if (notices) {
    console.log(`source: texaspublicnotices results page ${notices} (free)`);
    return publicNoticeFromFile(notices);
  }
  if (process.argv.includes("--live-notices")) {
    console.log("source: texaspublicnotices.com live search (free; brittle — prefer a saved page)");
    return publicNoticeLive();
  }
  const uni = uniCourtSource();
  if (uni) {
    console.log("source: UniCourt LDaaS (UNICOURT_API_KEY set)");
    return uni;
  }
  const file = arg("--file");
  if (file) {
    console.log(`source: export file ${file}`);
    return exportFileSource(file);
  }
  throw new Error(
    "no probate source configured. Free options:\n" +
      "  --notices-file <saved texaspublicnotices results.html>   (recommended, free)\n" +
      "  --live-notices                                           (free, brittle WebForms)\n" +
      "  --file <export.csv|json>                                 (re:SearchTX/bulk export)\n" +
      "  UNICOURT_API_KEY=…                                       (licensed API)\n" +
      "(We do not scrape the reCAPTCHA-protected Odyssey portal; see probate/README.md.)",
  );
}

interface ScoreResult {
  probability: number;
  base_probability: number;
  score: number;
  velocity: number;
  factors: Prisma.InputJsonValue;
  modelVersion: string;
}

async function main() {
  const source = selectSource();
  const since = new Date(arg("--since") ?? "2025-01-01");
  const limit = arg("--limit") ? Number(arg("--limit")) : 500;
  const minConfidence = arg("--min-confidence") ? Number(arg("--min-confidence")) : 0.5;

  // 1 ── pull real filings ──
  const filings: ProbateFiling[] = await source.fetchFilings(since, { limit });
  console.log(`fetched ${filings.length} probate filings since ${since.toISOString().slice(0, 10)}`);

  // 2 ── resolve decedents to properties; create events only for confident matches ──
  const stats = { matched: 0, quarantined: 0, events: 0, enqueued: 0 };
  const affected = new Set<string>();

  for (const f of filings) {
    const match = await matchDecedentToProperty(f.decedentName, { minConfidence });
    if (!match) {
      stats.quarantined++;
      continue;
    }
    stats.matched++;
    const created = await prisma.propertyEvent.create({
      data: {
        propertyId: match.propertyId,
        type: PropertyEventType.PROBATE,
        occurredAt: f.filedAt,
        source: f.source,
        sourceRef: f.causeNumber || null,
        payload: {
          decedentName: f.decedentName,
          matchedOwner: match.ownerName,
          matchConfidence: match.confidence,
          caseType: f.caseType,
          court: f.court,
        },
      },
    });
    stats.events++;
    if (!affected.has(match.propertyId)) {
      affected.add(match.propertyId);
      await redis.xadd(STREAM, "*", "propertyId", match.propertyId, "reason", "PROBATE");
      stats.enqueued++;
    }
    console.log(
      `  ${f.decedentName} → ${match.ownerName} (conf ${match.confidence}) · ${f.causeNumber || "no cause#"} [${f.source}] (event ${created.id.slice(0, 8)})`,
    );
  }
  console.log(
    `\nmatched ${stats.matched}, quarantined ${stats.quarantined} (no confident property match), ` +
      `${stats.events} PROBATE events, ${stats.enqueued} enqueued`,
  );

  // 3 ── drain the queue: rescore via ml, write refreshed SellerScore ──
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
    console.log(`  rescored ${propertyId}: score ${r.score} (+${r.velocity}) ${r.modelVersion}`);
  }

  console.log(`\ndone: ${stats.events} events from ${source.name}, ${rescored} rescored`);
  await redis.quit();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
