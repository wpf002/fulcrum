import type { FastifyInstance } from "fastify";
import { prisma } from "@fulcrum/db";

const ML = process.env.ML_SERVICE_URL ?? "http://localhost:8000";

export function registerOutcomeRoutes(app: FastifyInstance) {
  // Model Track Record: aggregate accuracy + retrain decision from the ml
  // service, joined with the confirmed outcomes recorded in the database.
  app.get("/v1/model/track-record", async (_req, reply) => {
    let track: unknown = null;
    let latestRetrain: unknown = null;
    try {
      const r = await fetch(`${ML}/model/track-record`);
      if (r.ok) {
        const j = (await r.json()) as { track: unknown; latestRetrain: unknown };
        track = j.track;
        latestRetrain = j.latestRetrain;
      }
    } catch {
      /* ml offline — DB stats still render */
    }

    const [total, viaBuyer, recent] = await Promise.all([
      prisma.outcome.count(),
      prisma.outcome.count({ where: { viaTrackedBuyer: true } }),
      prisma.outcome.findMany({
        orderBy: { soldAt: "desc" },
        take: 25,
        include: {
          property: { select: { addressLine1: true, zip: true } },
          predictedSellerScore: { select: { score: true } },
        },
      }),
    ]);

    return reply.send({
      track,
      latestRetrain,
      db: {
        confirmedSales: total,
        viaTrackedBuyer: viaBuyer,
        recent: recent.map((o) => ({
          id: o.id,
          address: o.property.addressLine1,
          zip: o.property.zip,
          soldAt: o.soldAt,
          predictedScore: o.predictedSellerScore?.score ?? null,
          salePriceCents: o.salePriceCents.toString(),
          viaTrackedBuyer: o.viaTrackedBuyer,
        })),
      },
    });
  });
}
