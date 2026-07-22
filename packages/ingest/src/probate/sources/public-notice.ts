/**
 * Free probate source — Texas "Notice to Creditors" legal notices.
 *
 * When a Texas estate opens, the executor MUST publish a Notice to Creditors
 * naming the decedent, cause number, and court (Estates Code §308.051). The
 * Texas Press Association aggregates every county's notices for free at
 * texaspublicnotices.com — robots.txt allows `/`, there's no CAPTCHA, and
 * public access is the site's whole purpose. This is the zero-cost real source.
 *
 * Fetch reliability: the search is ASP.NET WebForms that renders results via an
 * async postback, so a raw HTTP client can't reliably drive it. The robust
 * production fetch is a scheduled **headless browser** (Playwright) running the
 * search, OR a human saving the results page. Either way the durable part is
 * the PARSER here, which turns notice prose into structured filings.
 *
 * Respect the site's Terms of Use and keep any live fetch polite (low rate).
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

/** Parse a saved search-results page (headless-browser output or manual save). */
export function publicNoticeFromFile(path: string): ProbateSource {
  return {
    name: `texaspublicnotices:${path.split("/").pop()}`,
    async fetchFilings(since, opts = {}) {
      const filings = parseNotices(readFileSync(path, "utf8")).filter((f) => f.filedAt >= since);
      return opts.limit ? filings.slice(0, opts.limit) : filings;
    },
  };
}

// ── best-effort live search (WebForms; brittle — prefer a headless browser) ──
const BASE = "https://www.texaspublicnotices.com";
const TRAVIS_COUNTY_IDX = "221"; // ctl00$ContentPlaceHolder1$as1$lstCounty$221
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export function publicNoticeLive(): ProbateSource {
  return {
    name: "texaspublicnotices.com (live)",
    async fetchFilings(since, opts = {}) {
      const months = Math.max(1, Math.ceil((Date.now() - since.getTime()) / (30 * 86400e3)));
      const get = await fetch(`${BASE}/Search.aspx`, { headers: { "user-agent": UA }, redirect: "follow" });
      const sessionUrl = get.url;
      const html = await get.text();
      const hv = (id: string) => html.match(new RegExp(`id="${id}"[^>]*value="([^"]*)"`))?.[1] ?? "";
      const form = new URLSearchParams();
      form.set("__EVENTTARGET", "");
      form.set("__EVENTARGUMENT", "");
      form.set("__VIEWSTATE", hv("__VIEWSTATE"));
      form.set("__VIEWSTATEGENERATOR", hv("__VIEWSTATEGENERATOR"));
      form.set("ctl00$ContentPlaceHolder1$as1$txtSearch", "Letters Testamentary Deceased");
      form.set(`ctl00$ContentPlaceHolder1$as1$lstCounty$${TRAVIS_COUNTY_IDX}`, "on");
      form.set("ctl00$ContentPlaceHolder1$as1$txtLastNumMonths", String(months));
      form.set("ctl00$ContentPlaceHolder1$as1$btnGo1", "Search");
      const res = await fetch(sessionUrl, {
        method: "POST",
        headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
      const filings = parseNotices(await res.text()).filter((f) => f.filedAt >= since);
      if (!filings.length) {
        throw new Error(
          "no notices parsed from live search — the WebForms result likely rendered via async " +
            "postback. Use a headless browser to run the search and pass the saved results HTML " +
            "to publicNoticeFromFile(), or feed a manual export. See probate/README.md.",
        );
      }
      return opts.limit ? filings.slice(0, opts.limit) : filings;
    },
  };
}
