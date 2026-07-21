import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@fulcrum/db";
import { STREAM_BUYER_LEADS } from "@fulcrum/types";
import { redis } from "../redis.js";
import { computeReadinessScore } from "../readiness.js";

const submissionSchema = z.object({
  agentId: z.string().min(1),
  source: z.string().min(1),
  consent: z.object({
    termsVersion: z.string().min(1),
    channelOptIns: z.object({
      email: z.boolean(),
      sms: z.boolean(),
      tcpa: z.boolean(),
    }),
  }),
  contact: z
    .object({
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
    })
    .optional(),
  criteria: z
    .object({
      priceBandMinCents: z.coerce.bigint().optional(),
      priceBandMaxCents: z.coerce.bigint().optional(),
      targetGeographies: z.array(z.string()).optional(),
      minBeds: z.number().int().optional(),
      minBaths: z.number().optional(),
      propertyType: z.string().optional(),
      mustHaves: z.record(z.unknown()).optional(),
    })
    .optional(),
  readiness: z
    .object({
      affordabilityResultCents: z.coerce.bigint().optional(),
      mortgageReadinessAnswers: z.record(z.unknown()).optional(),
      timelineMonths: z.number().int().optional(),
    })
    .optional(),
});

export function registerLeadRoutes(app: FastifyInstance) {
  // Widget POSTs here on tool completion. Consent is validated and written
  // first — no consent, no lead.
  app.post("/v1/leads", async (req, reply) => {
    const parsed = submissionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const body = parsed.data;

    const agent = await prisma.agent.findUnique({ where: { id: body.agentId } });
    if (!agent) return reply.code(404).send({ error: "unknown agent" });

    const readinessScore = computeReadinessScore(body.readiness);

    const lead = await prisma.$transaction(async (tx) => {
      const consent = await tx.consent.create({
        data: {
          termsVersion: body.consent.termsVersion,
          ip: req.ip,
          toolSource: body.source,
          channelOptIns: body.consent.channelOptIns,
        },
      });
      return tx.buyerLead.create({
        data: {
          agentId: agent.id,
          consentId: consent.id,
          firstName: body.contact?.firstName,
          lastName: body.contact?.lastName,
          email: body.contact?.email,
          phone: body.contact?.phone,
          priceBandMinCents: body.criteria?.priceBandMinCents,
          priceBandMaxCents: body.criteria?.priceBandMaxCents,
          targetGeographies: body.criteria?.targetGeographies ?? [],
          minBeds: body.criteria?.minBeds,
          minBaths: body.criteria?.minBaths,
          propertyType: body.criteria?.propertyType,
          mustHaves: body.criteria?.mustHaves as object | undefined,
          affordabilityResultCents: body.readiness?.affordabilityResultCents,
          mortgageReadinessAnswers: body.readiness
            ?.mortgageReadinessAnswers as object | undefined,
          timelineMonths: body.readiness?.timelineMonths,
          readinessScore,
          source: body.source,
        },
      });
    });

    await redis.xadd(
      STREAM_BUYER_LEADS,
      "*",
      "leadId",
      lead.id,
      "agentId",
      agent.id
    );

    return reply.code(201).send({ id: lead.id, readinessScore });
  });

  app.get("/v1/agents/:agentId/leads", async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const leads = await prisma.buyerLead.findMany({
      where: { agentId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return reply.send(
      leads.map((l) => ({
        ...l,
        priceBandMinCents: l.priceBandMinCents?.toString() ?? null,
        priceBandMaxCents: l.priceBandMaxCents?.toString() ?? null,
        affordabilityResultCents: l.affordabilityResultCents?.toString() ?? null,
      }))
    );
  });
}
