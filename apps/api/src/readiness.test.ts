import { describe, it, expect } from "vitest";
import { computeReadinessScore } from "./readiness.js";

describe("computeReadinessScore", () => {
  it("is 0 with no input", () => {
    expect(computeReadinessScore()).toBe(0);
    expect(computeReadinessScore({})).toBe(0);
  });

  it("scores the fully-ready buyer at 100", () => {
    // 30 (affordability) + 20 (answered) + 20 (pre-approved) + 10 (down saved) + 20 (<=3mo)
    expect(
      computeReadinessScore({
        affordabilityResultCents: 32000000n,
        mortgageReadinessAnswers: { preApproved: true, downPaymentSaved: true },
        timelineMonths: 3,
      }),
    ).toBe(100);
  });

  it("weights timeline by recency", () => {
    const base = { affordabilityResultCents: 1n };
    expect(computeReadinessScore({ ...base, timelineMonths: 3 })).toBe(50);
    expect(computeReadinessScore({ ...base, timelineMonths: 6 })).toBe(45);
    expect(computeReadinessScore({ ...base, timelineMonths: 12 })).toBe(40);
    expect(computeReadinessScore({ ...base, timelineMonths: 24 })).toBe(35);
  });

  it("does not credit a zero affordability result", () => {
    expect(computeReadinessScore({ affordabilityResultCents: 0n })).toBe(0);
  });

  it("caps at 100", () => {
    expect(computeReadinessScore({
      affordabilityResultCents: 1n,
      mortgageReadinessAnswers: { preApproved: true, downPaymentSaved: true },
      timelineMonths: 1,
    })).toBeLessThanOrEqual(100);
  });
});
