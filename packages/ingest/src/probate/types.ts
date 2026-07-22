/**
 * Real probate-source contract.
 *
 * Travis County probate filings have no free, unauthenticated feed: the
 * Odyssey portal (odysseyweb.traviscountytx.gov) is reCAPTCHA + WAF protected
 * and its Terms forbid automated access, and the open Docket Search Application
 * is criminal-only. Production ingestion uses a LICENSED source — UniCourt
 * LDaaS, a re:SearchTX agreement, or County Clerk bulk data — behind these
 * adapters. We do not scrape the CAPTCHA-protected portal.
 */

/** One normalized probate filing, whatever the source. */
export interface ProbateFiling {
  causeNumber: string; // e.g. C-1-PB-25-001234
  decedentName: string; // legal name as filed
  filedAt: Date;
  caseType: string; // "Application for Probate of Will", "Small Estate Affidavit", ...
  court: string; // e.g. "Travis County Probate Court No. 1"
  source: string; // provenance: which licensed source produced this
}

/** A probate data source (UniCourt, re:SearchTX/bulk export, ...). */
export interface ProbateSource {
  readonly name: string;
  /** Fetch filings recorded on/after `since`. */
  fetchFilings(since: Date, opts?: { limit?: number }): Promise<ProbateFiling[]>;
}
