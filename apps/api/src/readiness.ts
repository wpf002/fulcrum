// Rules-based readiness scoring (0–100). Deliberately simple and explainable —
// the ML readiness model comes later; rules ship first so agents can debug
// why a lead scored what it did.

interface ReadinessInput {
  affordabilityResultCents?: bigint;
  mortgageReadinessAnswers?: Record<string, unknown>;
  timelineMonths?: number;
}

export function computeReadinessScore(input?: ReadinessInput): number {
  if (!input) return 0;
  let score = 0;

  // Completed the affordability tool with a real result
  if (input.affordabilityResultCents && input.affordabilityResultCents > 0n) {
    score += 30;
  }

  // Answered mortgage-readiness questions at all
  const answers = input.mortgageReadinessAnswers;
  if (answers && Object.keys(answers).length > 0) {
    score += 20;
    if (answers["preApproved"] === true) score += 20;
    if (answers["downPaymentSaved"] === true) score += 10;
  }

  // Timeline: sooner = readier
  if (typeof input.timelineMonths === "number") {
    if (input.timelineMonths <= 3) score += 20;
    else if (input.timelineMonths <= 6) score += 15;
    else if (input.timelineMonths <= 12) score += 10;
    else score += 5;
  }

  return Math.min(score, 100);
}
