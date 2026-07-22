import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma, MatchStatus } from "@fulcrum/db";

export function registerMatchRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] };

  // Ranked matches for the authenticated agent, with the buyer + property
  // context they need to act ("3 buyers want X · these likely-to-list homes").
  app.get("/v1/me/matches", auth, async (req, reply) => {
    const agentId = req.agentId;
    const { status } = req.query as { status?: string };

    const matches = await prisma.match.findMany({
      where: {
        agentId,
        ...(status ? { status: status as MatchStatus } : {}),
      },
      orderBy: { matchScore: "desc" },
      take: 200,
      include: {
        buyerLead: true,
        property: {
          include: {
            sellerScores: { orderBy: { computedAt: "desc" }, take: 1 },
            events: { select: { type: true }, orderBy: { occurredAt: "desc" } },
          },
        },
      },
    });

    return reply.send(
      matches.map((m) => {
        const s = m.property.sellerScores[0];
        return {
          id: m.id,
          matchScore: m.matchScore,
          status: m.status,
          factors: m.factors,
          surfacedAt: m.surfacedAt,
          buyer: {
            id: m.buyerLead.id,
            name: [m.buyerLead.firstName, m.buyerLead.lastName].filter(Boolean).join(" ") || "Buyer",
            email: m.buyerLead.email,
            phone: m.buyerLead.phone,
            readinessScore: m.buyerLead.readinessScore,
            priceBandMinCents: m.buyerLead.priceBandMinCents?.toString() ?? null,
            priceBandMaxCents: m.buyerLead.priceBandMaxCents?.toString() ?? null,
            timelineMonths: m.buyerLead.timelineMonths,
          },
          property: {
            id: m.property.id,
            address: m.property.addressLine1,
            zip: m.property.zip,
            ownerName: m.property.ownerName,
            ownerType: m.property.ownerType,
            avmEstimateCents: m.property.avmEstimateCents?.toString() ?? null,
            sellerScore: s ? Math.round(s.probabilityListMonths * 100) : null,
            eventTypes: [...new Set(m.property.events.map((e) => e.type))],
          },
        };
      }),
    );
  });

  // Summary counts for the match dashboard header.
  app.get("/v1/me/matches/summary", auth, async (req) => {
    const agentId = req.agentId;
    const [surfaced, buyers, properties] = await Promise.all([
      prisma.match.count({ where: { agentId, status: "SURFACED" } }),
      prisma.match.findMany({ where: { agentId }, select: { buyerLeadId: true }, distinct: ["buyerLeadId"] }),
      prisma.match.findMany({ where: { agentId }, select: { propertyId: true }, distinct: ["propertyId"] }),
    ]);
    return { surfaced, buyers: buyers.length, properties: properties.length };
  });

  const statusSchema = z.object({
    status: z.enum(["SURFACED", "CONTACTED", "DISMISSED", "CONVERTED"]),
  });

  // Agent acts on a match — the status lifecycle the match layer tracks.
  // Ownership-enforced: only the match's own agent may update it.
  app.post("/v1/matches/:id/status", auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await prisma.match.updateMany({
      where: { id, agentId: req.agentId },
      data: { status: parsed.data.status as MatchStatus },
    });
    if (result.count === 0) return reply.code(404).send({ error: "match not found" });
    return reply.send({ id, status: parsed.data.status });
  });
}
