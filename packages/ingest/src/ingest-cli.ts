/**
 * County-dispatch ingest CLI.
 *
 *   tsx src/ingest-cli.ts <county> <export.zip> [member] [--limit N]
 *   tsx src/ingest-cli.ts --list
 *
 * e.g.  tsx src/ingest-cli.ts travis ./tcad_2025.zip
 *       tsx src/ingest-cli.ts williamson ./wcad_2025.zip PROP.TXT
 */

import { prisma } from "@fulcrum/db";
import { COUNTIES, resolveCounty } from "./counties/registry.js";
import { ingestCounty } from "./ingest-core.js";

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--list" || args.length === 0) {
    console.log("counties:");
    for (const c of Object.values(COUNTIES)) {
      console.log(`  ${c.key.padEnd(12)} ${c.name} (FIPS ${c.fips}, ${c.format})`);
    }
    if (args.length === 0) console.log("\nusage: ingest-cli <county> <export.zip> [member] [--limit N]");
    return;
  }

  const [countyKey, zipPath] = args;
  if (!zipPath) throw new Error("usage: ingest-cli <county> <export.zip> [member] [--limit N]");
  const county = resolveCounty(countyKey);

  const member = args[2] && !args[2].startsWith("--") ? args[2] : county.propMember;
  const limitArg = args.indexOf("--limit");
  const limit = limitArg > -1 ? Number(args[limitArg + 1]) : undefined;

  console.log(`ingesting ${county.name} (FIPS ${county.fips}) from ${zipPath}:${member}`);
  const stats = await ingestCounty(county, zipPath, member, { limit });
  console.log(
    `done: read=${stats.read} loaded=${stats.loaded} ` +
      `quarantined=${stats.quarantined} saleEvents=${stats.events}`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
