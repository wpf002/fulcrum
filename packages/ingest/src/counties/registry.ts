/**
 * County registry — the templatization that turns "add a metro" from a
 * rewrite into a config entry (build plan §6/§10: ingest is the bottleneck).
 *
 * A county declares its FIPS, an id prefix, address defaults, and an export
 * FORMAT. Counties sharing a format (e.g. the PACS / TrueAutomation appraisal
 * export used across many Texas CADs) reuse the same reader — adding one is a
 * few lines here. A county on a different vendor's system needs a new format
 * reader in ./<format>.ts, then a registry entry; everything downstream
 * (identity resolution, scoring, matching, outcomes) is unchanged.
 */

export type ExportFormat = "pacs";

export interface CountyConfig {
  key: string; // cli handle, e.g. "travis"
  name: string;
  fips: string;
  idPrefix: string; // deterministic Property id prefix, e.g. "trav"
  state: string;
  defaultCity: string;
  format: ExportFormat;
  propMember: string; // the property file inside the export zip
  sourceName: string;
}

export const COUNTIES: Record<string, CountyConfig> = {
  travis: {
    key: "travis",
    name: "Travis County, TX",
    fips: "48453",
    idPrefix: "trav",
    state: "TX",
    defaultCity: "AUSTIN",
    format: "pacs",
    propMember: "PROP.TXT",
    sourceName: "tcad-certified-export",
  },
  // Illustrative second PACS county — proves adding a same-format metro is
  // config-only. (Verify the real WCAD export layout/member before a live run;
  // some TX counties run a different vendor and need a new format reader.)
  williamson: {
    key: "williamson",
    name: "Williamson County, TX",
    fips: "48491",
    idPrefix: "will",
    state: "TX",
    defaultCity: "GEORGETOWN",
    format: "pacs",
    propMember: "PROP.TXT",
    sourceName: "wcad-certified-export",
  },
};

export function resolveCounty(key: string): CountyConfig {
  const c = COUNTIES[key.toLowerCase()];
  if (!c) {
    throw new Error(
      `unknown county "${key}". known: ${Object.keys(COUNTIES).join(", ")}`,
    );
  }
  return c;
}
