/**
 * Sync an agent's Fulcrum matches into Follow Up Boss.
 *
 *   FULCRUM_API_URL=http://localhost:3011 tsx src/sync-fub.ts <agentId>
 *
 * Dry-run unless FUB_API_KEY is set (then it creates real FUB people + notes).
 */

import { FulcrumClient } from "@fulcrum/client";
import { pushBuyer } from "./followupboss.js";

async function main() {
  const [agentId] = process.argv.slice(2);
  if (!agentId) throw new Error("usage: sync-fub <agentId>");

  const client = new FulcrumClient(process.env.FULCRUM_API_URL);
  const apiKey = process.env.FUB_API_KEY;
  const matches = await client.matches(agentId);

  // group matches by buyer
  const byBuyer = new Map<string, typeof matches>();
  for (const m of matches) {
    const arr = byBuyer.get(m.buyer.id) ?? [];
    arr.push(m);
    byBuyer.set(m.buyer.id, arr);
  }

  console.log(
    `syncing ${byBuyer.size} buyers → Follow Up Boss ` +
      `(${apiKey ? "LIVE" : "DRY-RUN — set FUB_API_KEY to send"})`,
  );

  let people = 0;
  for (const buyerMatches of byBuyer.values()) {
    const r = await pushBuyer(buyerMatches, { apiKey });
    people++;
    if (r.sent) console.log(`  ${r.buyer}: FUB person ${r.personId}`);
  }
  console.log(`\ndone: ${people} buyers ${apiKey ? "pushed" : "previewed"}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
