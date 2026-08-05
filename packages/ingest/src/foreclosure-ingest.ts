/**
 * Travis County foreclosure ingest → rescore (NOD_PREFORECLOSURE signal).
 *
 * Parses Texas trustee-sale notices, resolves each to the property by ADDRESS,
 * and — for confident matches only — writes a NOD_PREFORECLOSURE PropertyEvent
 * (the second-strongest prior in the model) that triggers a rescore.
 *
 * Source: free Texas public notices (texaspublicnotices.com). The property
 * address lives on each notice's detail page, so a saved detail-pages file is
 * the reliable input (see foreclosure/README.md); a licensed feed also works.
 *
 * Usage: tsx src/foreclosure-ingest.ts --file <notices.html|txt> [--since YYYY-MM-DD] [--limit N]
 */

import { readFileSync } from "node:fs";
import { prisma, PropertyEventType } from "@fulcrum/db";
import { redis } from "./redis.js";
import { parseForeclosureNotices } from "./foreclosure/parse.js";
import { matchAddressToProperty } from "./foreclosure/address.js";
import { enqueueRescore, drainAndRescore } from "./events/rescore.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const file = arg("--file");
  if (!file) {
    console.error("usage: tsx src/foreclosure-ingest.ts --file <notices.html|txt> [--since YYYY-MM-DD] [--limit N]");
    console.error("(fetch notices first: pnpm --filter @fulcrum/ingest fetch:foreclosures ./notices.html)");
    process.exit(1);
  }
  const since = new Date(arg("--since") ?? "2025-01-01");
  const limit = arg("--limit") ? Number(arg("--limit")) : 500;

  const filings = parseForeclosureNotices(readFileSync(file, "utf8"))
    .filter((f) => !f.saleDate || f.saleDate >= since)
    .slice(0, limit);
  console.log(`parsed ${filings.length} foreclosure notices from ${file}`);

  const stats = { matched: 0, quarantined: 0, events: 0 };
  const affected = new Set<string>();

  for (const f of filings) {
    const match = await matchAddressToProperty(f.address, f.zip);
    if (!match) {
      stats.quarantined++;
      continue;
    }
    stats.matched++;
    await prisma.propertyEvent.create({
      data: {
        propertyId: match.propertyId,
        type: PropertyEventType.NOD_PREFORECLOSURE,
        occurredAt: f.saleDate ?? new Date(),
        source: f.source,
        sourceRef: f.ref,
        payload: {
          noticeAddress: f.address,
          matchedAddress: match.address,
          matchConfidence: match.confidence,
          saleDate: f.saleDate?.toISOString() ?? null,
        },
      },
    });
    stats.events++;
    affected.add(match.propertyId);
    console.log(`  ${f.address} → ${match.address} (conf ${match.confidence}) [${f.source}]`);
  }

  await enqueueRescore(affected, "NOD_PREFORECLOSURE");
  console.log(
    `\nmatched ${stats.matched}, quarantined ${stats.quarantined} (no confident property match), ` +
      `${stats.events} NOD events`,
  );

  const rescored = await drainAndRescore();
  console.log(`\ndone: ${stats.events} events, ${rescored} rescored`);
  await redis.quit();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
