import type { FastifyInstance } from "fastify";
import { prisma, Prisma } from "@fulcrum/db";

interface ScoredPropertyRow {
  id: string;
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
  ownerName: string | null;
  ownerType: string | null;
  ownershipTenureMonths: number | null;
  assessedValueCents: bigint | null;
  avmEstimateCents: bigint | null;
  score: number;
  probabilityListMonths: number;
  velocity: number;
  factors: unknown;
  modelVersion: string;
  computedAt: Date;
}

async function scoredProperties(zipList: string[], take: number) {
  if (!zipList.length) return [];
  const rows = await prisma.$queryRaw<ScoredPropertyRow[]>`
    SELECT p.id, p."addressLine1", p.city, p.state, p.zip,
           p."ownerName", p."ownerType", p."ownershipTenureMonths",
           p."assessedValueCents", p."avmEstimateCents",
           s.score, s."probabilityListMonths", s.velocity,
           s.factors, s."modelVersion", s."computedAt"
    FROM "Property" p
    JOIN LATERAL (
      SELECT * FROM "SellerScore" s
      WHERE s."propertyId" = p.id
      ORDER BY s."computedAt" DESC
      LIMIT 1
    ) s ON true
    WHERE p.zip IN (${Prisma.join(zipList)})
      AND p."resolutionStatus" = 'RESOLVED'
    ORDER BY s.score DESC, s."probabilityListMonths" DESC
    LIMIT ${take}
  `;
  return rows.map((r) => ({
    ...r,
    assessedValueCents: r.assessedValueCents?.toString() ?? null,
    avmEstimateCents: r.avmEstimateCents?.toString() ?? null,
  }));
}

export function registerPropertyRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] };

  // Scored properties in the authenticated agent's own territory.
  app.get("/v1/me/properties", auth, async (req, reply) => {
    const agent = await prisma.agent.findUnique({ where: { id: req.agentId } });
    const zips = ((agent?.territories as { zips?: string[] } | null)?.zips ?? []).filter(Boolean);
    const { limit } = req.query as { limit?: string };
    const take = Math.min(Number(limit ?? 50) || 50, 500);
    return reply.send(await scoredProperties(zips, take));
  });

  // Scored properties by explicit zip list (shared county data; auth required).
  app.get("/v1/properties", auth, async (req, reply) => {
    const { zips, limit } = req.query as { zips?: string; limit?: string };
    if (!zips) return reply.code(400).send({ error: "zips query param required" });
    const zipList = zips.split(",").map((z) => z.trim()).filter(Boolean);
    const take = Math.min(Number(limit ?? 50) || 50, 500);
    return reply.send(await scoredProperties(zipList, take));
  });

  // Single property + its latest score + events (used by the MCP fulcrum_score
  // tool and integrations).
  app.get("/v1/properties/:id", auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await prisma.property.findUnique({
      where: { id },
      include: {
        sellerScores: { orderBy: { computedAt: "desc" }, take: 1 },
        events: { select: { type: true, occurredAt: true }, orderBy: { occurredAt: "desc" }, take: 20 },
      },
    });
    if (!p) return reply.code(404).send({ error: "unknown property" });
    const s = p.sellerScores[0];
    return reply.send({
      id: p.id,
      address: p.addressLine1,
      city: p.city,
      state: p.state,
      zip: p.zip,
      ownerName: p.ownerName,
      ownerType: p.ownerType,
      ownershipTenureMonths: p.ownershipTenureMonths,
      avmEstimateCents: p.avmEstimateCents?.toString() ?? null,
      resolutionStatus: p.resolutionStatus,
      score: s ? Math.round(s.probabilityListMonths * 100) : null,
      probabilityListMonths: s?.probabilityListMonths ?? null,
      velocity: s?.velocity ?? null,
      factors: s?.factors ?? [],
      modelVersion: s?.modelVersion ?? null,
      events: p.events.map((e) => ({ type: e.type, occurredAt: e.occurredAt })),
    });
  });

  app.get("/v1/properties/stats", auth, async () => {
    const [total, resolved, quarantined, scored] = await Promise.all([
      prisma.property.count(),
      prisma.property.count({ where: { resolutionStatus: "RESOLVED" } }),
      prisma.property.count({ where: { resolutionStatus: "QUARANTINED" } }),
      prisma.sellerScore.count(),
    ]);
    return { total, resolved, quarantined, scored };
  });
}
