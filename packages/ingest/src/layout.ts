// TCAD PACS "Legacy 8.0.x" fixed-width appraisal export — PROP.TXT offsets.
// 1-indexed inclusive [start, end], verified identical across layout
// versions 8.0.25 (2022) through 8.0.33 (2025) against real records.

export interface FieldSpec {
  name: string;
  start: number;
  end: number;
}

export const PROP_FIELDS: FieldSpec[] = [
  { name: "propId", start: 1, end: 12 },
  { name: "propTypeCd", start: 13, end: 17 },
  { name: "geoId", start: 547, end: 596 },
  { name: "ownerName", start: 609, end: 678 },
  { name: "ownerAddrLine1", start: 694, end: 753 },
  { name: "ownerCity", start: 874, end: 923 },
  { name: "ownerState", start: 924, end: 973 },
  { name: "ownerZip", start: 979, end: 983 },
  { name: "situsStreetPrefix", start: 1040, end: 1049 },
  { name: "situsStreet", start: 1050, end: 1099 },
  { name: "situsStreetSuffix", start: 1100, end: 1109 },
  { name: "situsCity", start: 1110, end: 1139 },
  { name: "situsZip", start: 1140, end: 1149 },
  { name: "legalAcreage", start: 1660, end: 1675 },
  { name: "hoodCd", start: 1686, end: 1695 },
  { name: "appraisedVal", start: 1916, end: 1930 },
  { name: "assessedVal", start: 1946, end: 1960 },
  { name: "deedBookId", start: 1994, end: 2013 },
  { name: "deedBookPage", start: 2014, end: 2033 },
  { name: "deedDt", start: 2034, end: 2058 },
  { name: "mortgageCoId", start: 2059, end: 2070 },
  { name: "mortgageCoName", start: 2071, end: 2140 },
  { name: "hsExempt", start: 2609, end: 2609 },
  { name: "ov65Exempt", start: 2610, end: 2610 },
  { name: "dpExempt", start: 2662, end: 2662 },
  { name: "imprvStateCd", start: 2732, end: 2741 },
  { name: "marketValue", start: 4214, end: 4227 },
  { name: "situsNum", start: 4460, end: 4474 },
  { name: "situsUnit", start: 4475, end: 4479 },
];

export type PropRecord = Record<string, string>;

export function parseLine(line: string, fields: FieldSpec[]): PropRecord {
  const rec: PropRecord = {};
  for (const f of fields) {
    rec[f.name] = line.slice(f.start - 1, f.end).trim();
  }
  return rec;
}
