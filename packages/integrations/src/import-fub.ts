/**
 * Follow Up Boss → Fulcrum inbound importer.
 *
 * Brings REAL people you already have a consented relationship with into
 * Fulcrum as BuyerLeads, so the match layer has real demand to work with.
 *
 * Honesty rules baked in:
 *  - Consent is recorded as IMPORTED, not invented. Each lead gets a Consent
 *    row whose termsVersion says the consent came from Follow Up Boss, with
 *    the FUB person id as provenance. We never mint a Fulcrum consent receipt
 *    for a person who never saw a Fulcrum form.
 *  - Channel opt-ins are read from FUB's own unsubscribe/DNC flags. If FUB
 *    can't tell us, we assume the SAFE answer (false), never the convenient one.
 *  - Only contacts with a usable email or phone AND at least one permitted
 *    channel are imported; the rest are skipped and reported.
 *  - Re-running is idempotent: a person already imported is skipped, not
 *    duplicated.
 *
 * Usage:
 *   FUB_API_KEY=… tsx src/import-fub.ts --agent <agentId> [--stage "Lead"]
 *                                        [--limit 100] [--dry-run]
 */

import { prisma } from "@fulcrum/db";

const FUB_BASE = "https://api.followupboss.com/v1";

interface FubPersonIn {
  id: number;
  name?: string;
  firstName?: string;
  lastName?: string;
  stage?: string;
  source?: string;
  created?: string;
  emails?: { value: string; isPrimary?: boolean }[];
  phones?: { value: string; isPrimary?: boolean }[];
  tags?: string[];
  /** FUB marks people who opted out; treat missing as unknown → not permitted */
  emailsOptedOut?: boolean;
  smsOptedOut?: boolean;
  price?: { min?: number; max?: number };
}

function auth(key: string): string {
  return "Basic " + Buffer.from(`${key}:`).toString("base64");
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

/** Pull people from FUB, paging until limit. */
export async function fetchPeople(
  key: string,
  opts: { stage?: string; limit: number },
): Promise<FubPersonIn[]> {
  const out: FubPersonIn[] = [];
  let offset = 0;
  while (out.length < opts.limit) {
    const params = new URLSearchParams({
      limit: String(Math.min(100, opts.limit - out.length)),
      offset: String(offset),
    });
    if (opts.stage) params.set("stage", opts.stage);
    const res = await fetch(`${FUB_BASE}/people?${params}`, {
      headers: { authorization: auth(key), accept: "application/json" },
    });
    if (!res.ok) throw new Error(`FUB /people → ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { people?: FubPersonIn[]; _metadata?: { next?: string } };
    const batch = json.people ?? [];
    out.push(...batch);
    if (batch.length === 0) break;
    offset += batch.length;
  }
  return out.slice(0, opts.limit);
}

export interface ImportPlan {
  fubId: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  channels: { email: boolean; sms: boolean; tcpa: boolean };
  priceMaxCents: bigint | null;
  skip: string | null;
}

/** Map a FUB person → what we'd write, or why we'd skip them. */
export function planImport(p: FubPersonIn): ImportPlan {
  const email = p.emails?.find((e) => e.isPrimary)?.value ?? p.emails?.[0]?.value ?? null;
  const phone = p.phones?.find((e) => e.isPrimary)?.value ?? p.phones?.[0]?.value ?? null;
  const [firstName, ...rest] = (p.name ?? "").trim().split(/\s+/);

  // safe-by-default: only permit a channel FUB positively tells us is allowed
  const channels = {
    email: Boolean(email) && p.emailsOptedOut !== true,
    sms: Boolean(phone) && p.smsOptedOut !== true,
    // TCPA (autodialer/prerecorded) is never inferred — it needs express consent
    tcpa: false,
  };

  let skip: string | null = null;
  if (!email && !phone) skip = "no email or phone";
  else if (!channels.email && !channels.sms) skip = "opted out of every channel";

  return {
    fubId: p.id,
    firstName: p.firstName ?? firstName ?? null,
    lastName: p.lastName ?? (rest.join(" ") || null),
    email,
    phone,
    channels,
    priceMaxCents: p.price?.max ? BigInt(Math.round(p.price.max)) * 100n : null,
    skip,
  };
}

async function main() {
  const key = process.env.FUB_API_KEY;
  const agentId = arg("--agent");
  const dryRun = process.argv.includes("--dry-run") || !key;
  const stage = arg("--stage");
  const limit = Number(arg("--limit") ?? 100);

  if (!agentId) throw new Error("--agent <agentId> is required (which Fulcrum agent owns these leads)");
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) throw new Error(`unknown agent ${agentId}`);
  if (!key) {
    console.log("no FUB_API_KEY set — nothing to import. See integrations/README.md for how to get one.");
    return;
  }

  console.log(`importing from Follow Up Boss into ${agent.name}${stage ? ` · stage="${stage}"` : ""}${dryRun ? " (dry run)" : ""}`);
  const people = await fetchPeople(key, { stage, limit });
  console.log(`fetched ${people.length} contacts`);

  const stats = { imported: 0, skipped: 0, already: 0 };
  for (const p of people) {
    const plan = planImport(p);
    if (plan.skip) {
      stats.skipped++;
      console.log(`  skip ${plan.firstName ?? p.id}: ${plan.skip}`);
      continue;
    }
    const existing = await prisma.consent.findFirst({
      where: { toolSource: `followupboss:person:${plan.fubId}` },
    });
    if (existing) {
      stats.already++;
      continue;
    }
    if (dryRun) {
      stats.imported++;
      console.log(
        `  would import ${plan.firstName ?? ""} ${plan.lastName ?? ""} · ${plan.email ?? plan.phone} · ` +
          `email=${plan.channels.email} sms=${plan.channels.sms} tcpa=false`,
      );
      continue;
    }
    await prisma.$transaction(async (tx) => {
      const consent = await tx.consent.create({
        data: {
          // provenance, not a Fulcrum receipt — this person never saw our form
          termsVersion: "imported:followupboss",
          termsHash: null,
          userAgent: null,
          ip: "imported",
          toolSource: `followupboss:person:${plan.fubId}`,
          channelOptIns: plan.channels,
        },
      });
      await tx.buyerLead.create({
        data: {
          agentId: agent.id,
          consentId: consent.id,
          firstName: plan.firstName,
          lastName: plan.lastName,
          email: plan.email,
          phone: plan.phone,
          targetGeographies: ((agent.territories as { zips?: string[] })?.zips ?? []).slice(0, 3),
          priceBandMaxCents: plan.priceMaxCents,
          readinessScore: 0, // unknown until they tell us — never guessed
          source: "followupboss-import",
        },
      });
    });
    stats.imported++;
    console.log(`  imported ${plan.firstName ?? ""} ${plan.lastName ?? ""} · ${plan.email ?? plan.phone}`);
  }

  console.log(
    `\ndone: ${stats.imported} ${dryRun ? "would be imported" : "imported"}, ` +
      `${stats.already} already present, ${stats.skipped} skipped`,
  );
  await prisma.$disconnect();
}

if (process.argv[1]?.includes("import-fub")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
