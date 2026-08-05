/**
 * Shared event → rescore pipeline (used by the probate and foreclosure feeds).
 *
 * An event feed resolves a filing to a property and creates a PropertyEvent;
 * this module handles the common tail: enqueue the affected property to the
 * Redis `score.requests` stream, then drain it — call services/ml, and write
 * the refreshed SellerScore (probability, score, velocity, Factor[]).
 */

import { prisma, Prisma } from "@fulcrum/db";
import { redis } from "../redis.js";

export const SCORE_STREAM = "score.requests";
const ML = process.env.ML_SERVICE_URL ?? "http://localhost:8000";

interface ScoreResult {
  probability: number;
  base_probability: number;
  score: number;
  velocity: number;
  factors: Prisma.InputJsonValue;
  modelVersion: string;
}

/** Publish affected properties for rescoring. */
export async function enqueueRescore(propertyIds: Iterable<string>, reason: string): Promise<number> {
  let n = 0;
  for (const id of propertyIds) {
    await redis.xadd(SCORE_STREAM, "*", "propertyId", id, "reason", reason);
    n++;
  }
  return n;
}

/** Drain the score-request stream: score via ml, write refreshed SellerScores. */
export async function drainAndRescore(): Promise<number> {
  const pending = await redis.xrange(SCORE_STREAM, "-", "+");
  let rescored = 0;
  for (const [entryId, fields] of pending) {
    const idx = fields.indexOf("propertyId");
    const propertyId = idx > -1 ? fields[idx + 1] : null;
    if (!propertyId) continue;
    const res = await fetch(`${ML}/score/seller`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ propertyId }),
    });
    if (!res.ok) {
      console.warn(`  score failed for ${propertyId}: ${res.status}`);
      continue;
    }
    const r = (await res.json()) as ScoreResult;
    await prisma.sellerScore.create({
      data: {
        propertyId,
        probabilityListMonths: r.probability,
        score: r.score,
        velocity: r.velocity,
        factors: r.factors,
        modelVersion: r.modelVersion,
      },
    });
    await redis.xdel(SCORE_STREAM, entryId);
    rescored++;
    console.log(`  rescored ${propertyId}: score ${r.score} (+${r.velocity}) ${r.modelVersion}`);
  }
  return rescored;
}
