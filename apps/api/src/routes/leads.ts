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

    // The lead is already persisted; a Redis hiccup must not drop it. Publish
    // best-effort for the match layer (Phase 4) and log on failure.
    try {
      await redis.xadd(STREAM_BUYER_LEADS, "*", "leadId", lead.id, "agentId", agent.id);
    } catch (err) {
      req.log.warn({ err, leadId: lead.id }, "failed to publish buyer.leads stream");
    }

    return reply.code(201).send({ id: lead.id, readinessScore });
  });

  // Lead inbox for the authenticated agent (their own consented leads only).
  app.get("/v1/me/leads", { preHandler: [app.authenticate] }, async (req, reply) => {
    const agentId = req.agentId;
    const leads = await prisma.buyerLead.findMany({
      where: { agentId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { consent: true },
    });
    return reply.send(
      leads.map((l) => ({
        id: l.id,
        firstName: l.firstName,
        lastName: l.lastName,
        email: l.email,
        phone: l.phone,
        priceBandMinCents: l.priceBandMinCents?.toString() ?? null,
        priceBandMaxCents: l.priceBandMaxCents?.toString() ?? null,
        targetGeographies: l.targetGeographies,
        minBeds: l.minBeds,
        propertyType: l.propertyType,
        affordabilityResultCents: l.affordabilityResultCents?.toString() ?? null,
        mortgageReadinessAnswers: l.mortgageReadinessAnswers,
        timelineMonths: l.timelineMonths,
        readinessScore: l.readinessScore,
        source: l.source,
        createdAt: l.createdAt,
        consent: {
          termsVersion: l.consent.termsVersion,
          capturedAt: l.consent.capturedAt,
          channelOptIns: l.consent.channelOptIns,
          toolSource: l.consent.toolSource,
        },
      })),
    );
  });
}
