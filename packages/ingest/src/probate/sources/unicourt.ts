/**
 * UniCourt LDaaS probate source (the recommended production integration).
 *
 * UniCourt licenses structured Travis County court data — including probate —
 * via a real REST API. This adapter implements their search + case shape and is
 * gated on UNICOURT_API_KEY; without it we skip (no scraping fallback).
 *
 * Docs: https://unicourt.com/products/legal-data-api  (Travis probate:
 * https://unicourt.com/courts/state/texas-travis-court-system-38/probate)
 */

import type { ProbateFiling, ProbateSource } from "../types.js";

const BASE = process.env.UNICOURT_BASE ?? "https://enterpriseapi.unicourt.com";
// Travis County court system id in UniCourt's taxonomy (from the court URL).
const TRAVIS_COURT = "texas-travis-court-system-38";

interface UniCourtCase {
  caseNumber?: string;
  caseName?: string;
  caseType?: string;
  filedDate?: string;
  courtName?: string;
  parties?: { partyType?: string; fullName?: string }[];
}

function decedentOf(c: UniCourtCase): string {
  const p = c.parties?.find((x) => /decedent|deceased|estate/i.test(x.partyType ?? ""));
  // fall back to the estate name in caseName ("Estate of <name>")
  return p?.fullName ?? (c.caseName ?? "").replace(/^\s*(in re:?\s*)?(the\s+)?estate of\s*/i, "").trim();
}

export function uniCourtSource(apiKey = process.env.UNICOURT_API_KEY): ProbateSource | null {
  if (!apiKey) return null;
  return {
    name: "unicourt-ldaas",
    async fetchFilings(since, opts = {}) {
      const body = {
        courtSystemId: TRAVIS_COURT,
        caseCategory: "Probate",
        filedDateFrom: since.toISOString().slice(0, 10),
        pageSize: Math.min(opts.limit ?? 100, 100),
      };
      const res = await fetch(`${BASE}/search/cases`, {
        method: "POST",
        headers: { "x-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`UniCourt search → ${res.status}`);
      const json = (await res.json()) as { cases?: UniCourtCase[] };
      return (json.cases ?? []).map(
        (c): ProbateFiling => ({
          causeNumber: c.caseNumber ?? "",
          decedentName: decedentOf(c),
          filedAt: c.filedDate ? new Date(c.filedDate) : new Date(),
          caseType: c.caseType ?? "Probate",
          court: c.courtName ?? "Travis County Probate Court",
          source: "unicourt-ldaas",
        }),
      );
    },
  };
}
