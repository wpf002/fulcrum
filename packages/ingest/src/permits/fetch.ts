/**
 * City of Austin open-data client (Socrata).
 *
 * data.austintexas.gov publishes issued construction permits as a free JSON API
 * — no key, no CAPTCHA, robots.txt allows all with Crawl-delay: 1 (which we
 * honor). Crucially each permit carries `tcad_id`, the appraisal district's
 * parcel id, which joins EXACTLY to Property.apn — no fuzzy address matching.
 *
 * Dataset: Issued Construction Permits (3syk-w9eu)
 */

const DATASET = "https://data.austintexas.gov/resource/3syk-w9eu.json";
const CRAWL_DELAY_MS = 1000; // robots.txt: Crawl-delay: 1
const PAGE = 1000;

export interface AustinPermit {
  tcad_id?: string;
  permit_number?: string;
  permit_type_desc?: string;
  permit_class_mapped?: string;
  work_class?: string;
  description?: string;
  issue_date?: string;
  original_address1?: string;
  original_zip?: string;
  status_current?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchPermits(opts: {
  zips: string[];
  since: string; // YYYY-MM-DD
  limit?: number;
}): Promise<AustinPermit[]> {
  const limit = opts.limit ?? 2000;
  const zipList = opts.zips.map((z) => `'${z}'`).join(",");
  const out: AustinPermit[] = [];

  for (let offset = 0; out.length < limit; offset += PAGE) {
    const params = new URLSearchParams({
      $limit: String(Math.min(PAGE, limit - out.length)),
      $offset: String(offset),
      $where: `original_zip in (${zipList}) AND issue_date > '${opts.since}'`,
      $order: "issue_date DESC",
    });
    const res = await fetch(`${DATASET}?${params}`, {
      headers: { accept: "application/json", "user-agent": "Fulcrum/1.0 (seller-intelligence)" },
    });
    if (!res.ok) throw new Error(`Austin open data → ${res.status} ${await res.text()}`);
    const batch = (await res.json()) as AustinPermit[];
    out.push(...batch);
    if (batch.length < PAGE) break;
    await sleep(CRAWL_DELAY_MS);
  }
  return out;
}
