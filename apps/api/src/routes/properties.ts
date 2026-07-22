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

export function registerPropertyRoutes(app: FastifyInstance) {
  app.get("/v1/agents", async () => {
    const agents = await prisma.agent.findMany({
      select: { id: true, name: true, email: true, territories: true },
    });
    return agents;
  });

  // Scored properties in a territory (zip list), highest current score first.
  // Quarantined identity-resolution records are never surfaced.
  app.get("/v1/properties", async (req, reply) => {
    const { zips, limit } = req.query as { zips?: string; limit?: string };
    if (!zips) return reply.code(400).send({ error: "zips query param required" });
    const zipList = zips.split(",").map((z) => z.trim()).filter(Boolean);
    const take = Math.min(Number(limit ?? 50) || 50, 500);

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

    return reply.send(
      rows.map((r) => ({
        ...r,
        assessedValueCents: r.assessedValueCents?.toString() ?? null,
        avmEstimateCents: r.avmEstimateCents?.toString() ?? null,
      })),
    );
  });

  app.get("/v1/properties/stats", async () => {
    const [total, resolved, quarantined, scored] = await Promise.all([
      prisma.property.count(),
      prisma.property.count({ where: { resolutionStatus: "RESOLVED" } }),
      prisma.property.count({ where: { resolutionStatus: "QUARANTINED" } }),
      prisma.sellerScore.count(),
    ]);
    return { total, resolved, quarantined, scored };
  });
}
