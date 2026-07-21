import type { FastifyInstance } from "fastify";
import { prisma } from "@fulcrum/db";

export function registerPropertyRoutes(app: FastifyInstance) {
  // Scored properties in a territory (zip list), highest score first.
  // Quarantined identity-resolution records are never surfaced.
  app.get("/v1/properties", async (req, reply) => {
    const { zips } = req.query as { zips?: string };
    if (!zips) return reply.code(400).send({ error: "zips query param required" });

    const properties = await prisma.property.findMany({
      where: {
        zip: { in: zips.split(",") },
        resolutionStatus: "RESOLVED",
      },
      include: {
        sellerScores: { orderBy: { computedAt: "desc" }, take: 1 },
      },
      take: 500,
    });

    const rows = properties
      .map((p) => ({
        id: p.id,
        address: p.addressLine1,
        city: p.city,
        state: p.state,
        zip: p.zip,
        beds: p.beds,
        baths: p.baths,
        sqftLiving: p.sqftLiving,
        ownerType: p.ownerType,
        avmEstimateCents: p.avmEstimateCents?.toString() ?? null,
        score: p.sellerScores[0] ?? null,
      }))
      .sort((a, b) => (b.score?.score ?? -1) - (a.score?.score ?? -1));

    return reply.send(rows);
  });
}
