/**
 * Turn a City of Austin construction permit into a seller signal.
 *
 * Permits are a genuinely AMBIGUOUS signal, unlike probate or foreclosure, and
 * we model that honestly rather than treating every permit as bullish:
 *
 *  - Pre-sale prep (repair, small remodel, roof, HVAC, electrical fix) tends to
 *    come BEFORE a listing — an owner tidying up to sell.
 *  - Major investment (new construction, large addition, pool, ADU) usually
 *    means the owner is staying put, and if anything argues AGAINST a near-term
 *    sale. We surface those as a downward factor.
 *  - Everything else is treated as neutral and not recorded as a signal at all.
 */

export type PermitSignal = "prep" | "investment" | "neutral";

export interface PermitInput {
  work_class?: string;
  permit_class_mapped?: string;
  permit_type_desc?: string;
  description?: string;
}

const PREP_WORK = /^(remodel|repair|upgrade|addition and remodel)$/i;
const INVEST_WORK = /^(new|addition)$/i;
const PREP_TYPE = /roof|mechanical|electrical|plumbing|building/i;
const INVEST_TEXT = /\bpool\b|\bspa\b|accessory dwelling|\badu\b|new residence|new single family/i;

/** Residential permits only — commercial says nothing about a homeowner selling. */
export function isResidential(p: PermitInput): boolean {
  return /residential/i.test(p.permit_class_mapped ?? "");
}

export function classifyPermit(p: PermitInput): PermitSignal {
  if (!isResidential(p)) return "neutral";

  const text = `${p.description ?? ""}`;
  if (INVEST_TEXT.test(text)) return "investment";

  const work = (p.work_class ?? "").trim();
  if (INVEST_WORK.test(work)) return "investment";
  if (PREP_WORK.test(work) && PREP_TYPE.test(p.permit_type_desc ?? "")) return "prep";
  if (PREP_WORK.test(work)) return "prep";

  return "neutral";
}

/** Human label for the Why column. */
export function permitLabel(signal: PermitSignal, p: PermitInput): string {
  const kind = (p.work_class ?? "Work").toLowerCase();
  return signal === "prep"
    ? `Recent ${kind} permit`
    : `Major ${kind} permit (investing to stay)`;
}
