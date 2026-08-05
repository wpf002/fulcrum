/**
 * Parse property address + sale date from Texas foreclosure notices.
 *
 * A Notice of Substitute Trustee's Sale (Property Code §51.002) identifies the
 * property, usually with a street address alongside the legal description, e.g.
 *   "...the following described property: ... commonly known as
 *    1711 Crown Dr, Austin, TX 78745..."
 * or "Property Address: 1711 Crown Dr, Austin, Texas 78745". We pull the street
 * address + zip + scheduled sale date; the address is the match key.
 */

import type { ForeclosureFiling } from "./types.js";

function htmlToText(html: string): string {
  return /<[a-z]/i.test(html)
    ? html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim()
    : html.replace(/\s+/g, " ").trim();
}

const STREET =
  "(?:Dr(?:ive)?|St(?:reet)?|Rd|Road|Ln|Lane|Ave(?:nue)?|Blvd|Boulevard|Ct|Court|Trl|Trail|Cir(?:cle)?|Way|Path|Cv|Cove|Pass|Loop|B(?:en)?d|Pl(?:ace)?|Ter(?:race)?|Pkwy|Hwy|Run|Row)";
// "commonly known as / property address: <addr>, Austin, TX 78704"
const ADDR_RE = new RegExp(
  String.raw`(?:commonly known as|property address:?|address of property:?|street address:?)\s*` +
    String.raw`(\d{1,6}[\w .'-]*?\b${STREET}\b[\w .#-]*?)[,.]?\s*(?:Austin|Pflugerville|Del Valle|Manor|Lakeway)?[, ]*(?:TX|Texas)?\s*(\d{5})?`,
  "i",
);
// fallback: any "<num> <name> <suffix>, Austin ... <zip>"
const ADDR_FALLBACK = new RegExp(
  String.raw`(\d{1,6}\s+[A-Z][\w .'-]*?\b${STREET}\b)[,.]?\s*Austin[, ]*(?:TX|Texas)?\s*(\d{5})?`,
  "i",
);
const SALE_DATE_RE = /(?:sale (?:date|will be held|date and time)[^A-Za-z0-9]*|date of sale:?\s*)([A-Za-z]+ \d{1,2},? \d{4}|\d{1,2}\/\d{1,2}\/\d{4})/i;

function parseDate(s?: string): Date | null {
  if (!s) return null;
  const d = new Date(s.replace(/(\d)(st|nd|rd|th)/g, "$1"));
  return isNaN(d.getTime()) ? null : d;
}

export function parseForeclosureNotice(text: string): ForeclosureFiling | null {
  const m = text.match(ADDR_RE) ?? text.match(ADDR_FALLBACK);
  if (!m) return null;
  const address = m[1].replace(/\s+/g, " ").trim();
  const zip = m[2] ?? (text.match(/\bAustin,?\s*(?:TX|Texas)?\s*(\d{5})\b/i)?.[1] ?? null);
  return {
    address,
    zip,
    saleDate: parseDate(text.match(SALE_DATE_RE)?.[1]),
    source: "texaspublicnotices.com",
    ref: text.match(/\b(?:TS|T\.?S\.?|File)\s*(?:No\.?|#)?\s*([A-Z0-9-]{5,25})/i)?.[1] ?? null,
  };
}

/** Extract every trustee-sale notice from a results/detail page or raw text. */
export function parseForeclosureNotices(htmlOrText: string): ForeclosureFiling[] {
  const text = htmlToText(htmlOrText);
  const blocks = text.split(/(?=Notice of (?:Substitute )?(?:Trustee'?s|Foreclosure) Sale)/i);
  const out: ForeclosureFiling[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    const f = parseForeclosureNotice(b);
    if (f && !seen.has(f.address)) {
      seen.add(f.address);
      out.push(f);
    }
  }
  return out;
}
