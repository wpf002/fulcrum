/**
 * Export-file probate source.
 *
 * Ingests a real probate export — a re:SearchTX / County Clerk bulk extract, a
 * public-notice ("Notice to Creditors") scrape, or an authorized manual portal
 * export — as CSV or JSON. This is how real captured data flows without any
 * scraping. Expected fields (case-insensitive headers / JSON keys):
 *   causeNumber | cause | case_number
 *   decedentName | decedent | estate_of | name
 *   filedAt | filed | filing_date | date
 *   caseType | type
 */

import { readFileSync } from "node:fs";
import type { ProbateFiling, ProbateSource } from "../types.js";

function pick(o: Record<string, string>, keys: string[]): string {
  for (const k of Object.keys(o)) {
    if (keys.includes(k.toLowerCase().replace(/[\s_]/g, ""))) return o[k];
  }
  return "";
}

function toFiling(o: Record<string, string>, source: string): ProbateFiling | null {
  const decedentName = pick(o, ["decedentname", "decedent", "estateof", "name"]).trim();
  const causeNumber = pick(o, ["causenumber", "cause", "casenumber"]).trim();
  if (!decedentName) return null;
  const rawDate = pick(o, ["filedat", "filed", "filingdate", "date"]).trim();
  const d = rawDate ? new Date(rawDate) : new Date();
  return {
    causeNumber,
    decedentName,
    filedAt: isNaN(d.getTime()) ? new Date() : d,
    caseType: pick(o, ["casetype", "type"]).trim() || "Probate",
    court: "Travis County Probate Court No. 1",
    source,
  };
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? "").trim()]));
  });
}

export function exportFileSource(path: string, sourceLabel?: string): ProbateSource {
  const source = sourceLabel ?? `export-file:${path.split("/").pop()}`;
  return {
    name: source,
    async fetchFilings(since, opts = {}) {
      const text = readFileSync(path, "utf8");
      const rows: Record<string, string>[] = path.endsWith(".json")
        ? (JSON.parse(text) as Record<string, string>[])
        : parseCsv(text);
      const filings = rows
        .map((r) => toFiling(r, source))
        .filter((f): f is ProbateFiling => f !== null)
        .filter((f) => f.filedAt >= since);
      return opts.limit ? filings.slice(0, opts.limit) : filings;
    },
  };
}
