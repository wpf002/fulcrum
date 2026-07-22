import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma, MatchStatus } from "@fulcrum/db";

export function registerMatchRoutes(app: FastifyInstance) {
  // Ranked matches for an agent, with the buyer + property context the agent
  // needs to act ("3 buyers want X · these likely-to-list homes match").
  app.get("/v1/agents/:agentId/matches", async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
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
  app.get("/v1/agents/:agentId/matches/summary", async (req) => {
    const { agentId } = req.params as { agentId: string };
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
  app.post("/v1/matches/:id/status", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const updated = await prisma.match.update({
      where: { id },
      data: { status: parsed.data.status as MatchStatus },
    });
    return reply.send({ id: updated.id, status: updated.status });
  });
}
