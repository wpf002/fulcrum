/**
 * Parser for Texas "Notice to Creditors" probate notices.
 *
 * When a Texas estate opens, the representative must publish a Notice to
 * Creditors naming the decedent, cause number, and court (Estates Code
 * §308.051). This module turns that standardized prose into structured
 * filings — it is SOURCE-AGNOSTIC and works on any legitimately-obtained copy.
 *
 * ⚠️ NOT texaspublicnotices.com. That aggregator's Terms of Use expressly
 * prohibit using its content "in any database, compilation, archive or cache"
 * and prohibit "screen scraping … or use of any other automated means to
 * collect information from the site", and its notice detail pages are
 * challenge-gated. We do not scrape it and do not ingest its content.
 *
 * Use a source you are licensed/authorized to load into a database:
 *   - UniCourt LDaaS (licensed API) — see ./unicourt.ts
 *   - a re:SearchTX data agreement, or County Clerk bulk records
 *   - a vendor probate feed
 * See ../README.md.
 */

import { readFileSync } from "node:fs";
import type { ProbateFiling, ProbateSource } from "../types.js";

// Strip HTML to text so the parser works on a saved results page or raw text.
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDate(s: string): Date {
  const d = new Date(s.replace(/(\d)(st|nd|rd|th)/g, "$1"));
  return isNaN(d.getTime()) ? new Date() : d;
}

// One probate notice → structured filing. Texas Notice-to-Creditors prose:
//   "...original Letters Testamentary for the Estate of JOHN A SMITH, Deceased,
//    were issued on August 12, 2025, in Cause No. C-1-PB-25-001234, pending in
//    the Probate Court No. 1 of Travis County, Texas, to Mary Smith..."
const DECEDENT_RE =
  /Estate of\s+([A-Z][A-Za-z0-9.,'\-\s]{3,60}?),?\s+(?:Deceased|deceased|Dec'd)/;
const CAUSE_RE = /(?:Cause|Case|Docket)\s*(?:No\.?|Number|#)?\s*[:.]?\s*([A-Z0-9][A-Z0-9\-]{4,25})/i;
const ISSUED_RE = /issued on\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/i;
const COURT_RE = /pending in the\s+(.+?County (?:Probate )?Court(?:\s*(?:No\.?|Number)?\s*\w+)?)/i;
const TYPE_RE = /(Letters Testamentary|Letters of Administration|Small Estate Affidavit|Determination of Heirship|Muniment of Title)/i;

export function parseCreditorNotice(text: string): ProbateFiling | null {
  const raw = text.match(DECEDENT_RE)?.[1];
  // newspaper columns hyphenate words across line breaks ("ROB- ERT" →
  // "ROBERT"); a hyphen FOLLOWED BY a space between letters is a wrap artifact,
  // whereas real hyphenated names have no space ("Smith-Jones").
  const decedent = raw
    ?.replace(/([A-Za-z])-\s+([A-Za-z])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
  if (!decedent) return null;
  const cause = text.match(CAUSE_RE)?.[1] ?? "";
  const issued = text.match(ISSUED_RE)?.[1];
  const court = text.match(COURT_RE)?.[1]?.trim() ?? "Travis County Probate Court";
  const caseType = text.match(TYPE_RE)?.[1] ?? "Probate";
  return {
    causeNumber: cause,
    decedentName: decedent,
    filedAt: issued ? parseDate(issued) : new Date(),
    caseType,
    court,
    source: "texaspublicnotices.com",
  };
}

/**
 * Extract every probate notice from a results page (or raw text). Splits on the
 * notice boundary phrase so multiple notices on one page each parse cleanly.
 */
export function parseNotices(htmlOrText: string): ProbateFiling[] {
  const text = /<[a-z]/i.test(htmlOrText) ? htmlToText(htmlOrText) : htmlOrText;
  // each Texas notice-to-creditors begins around "Letters Testamentary/Administration"
  const blocks = text.split(/(?=(?:original\s+)?Letters (?:Testamentary|of Administration))/i);
  const out: ProbateFiling[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    const f = parseCreditorNotice(b);
    if (f && f.decedentName) {
      const key = `${f.decedentName}|${f.causeNumber}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(f);
      }
    }
  }
  return out;
}

/**
 * Parse probate notices from a legitimately-obtained file (licensed feed
 * export, County Clerk records, vendor delivery). See the module header:
 * do NOT feed this scraped aggregator content.
 */
export function probateNoticesFromFile(path: string): ProbateSource {
  return {
    name: `notice-file:${path.split("/").pop()}`,
    async fetchFilings(since, opts = {}) {
      const filings = parseNotices(readFileSync(path, "utf8")).filter((f) => f.filedAt >= since);
      return opts.limit ? filings.slice(0, opts.limit) : filings;
    },
  };
}
