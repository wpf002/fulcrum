"use client";

import { useMemo, useState } from "react";

export interface Factor {
  label: string;
  weight: number;
  direction: "up" | "down";
}

export interface ScoredProperty {
  id: string;
  addressLine1: string;
  city: string;
  zip: string;
  ownerName: string | null;
  ownerType: string | null;
  ownershipTenureMonths: number | null;
  avmEstimateCents: string | null;
  score: number;
  probabilityListMonths: number;
  velocity: number;
  factors: Factor[];
  modelVersion: string;
}

// Displayed score = P(market sale within 24mo) as 0–100. The DB `score`
// percentile saturates at 100 across the hot tier and carries no ranking
// signal; the calibrated probability does, and reads honestly.
function listScore(p: ScoredProperty): number {
  return Math.round(p.probabilityListMonths * 100);
}

// semantic heat scale — likelihood-to-list as literal temperature
function heat(s: number): string {
  if (s >= 75) return "#c1372b";
  if (s >= 60) return "#d96a3a";
  if (s >= 45) return "#c08a2e";
  if (s >= 30) return "#8a8f68";
  return "#5b6b7a";
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bLlc\b/g, "LLC")
    .replace(/\bTr\b/g, "TR");
}

function money(cents: string | null): string {
  if (!cents) return "—";
  const dollars = Number(BigInt(cents) / 100n);
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(2)}M`;
  return `$${Math.round(dollars / 1000)}K`;
}

function tenure(months: number | null): string {
  if (months == null) return "—";
  const yrs = months / 12;
  return yrs < 1 ? `${months}mo` : `${yrs.toFixed(0)}y`;
}

const OWNER: Record<string, { cls: string; label: string }> = {
  OWNER_OCCUPIED: { cls: "owner-occ", label: "Owner-occ" },
  ABSENTEE: { cls: "absentee", label: "Absentee" },
  ENTITY: { cls: "entity", label: "Entity" },
};

const RAW_LABELS: Record<string, string> = {
  tenure_months: "Tenure unknown",
  age_years: "Home age unknown",
  value_change_1yr: "No prior-year value",
  value_per_sqft: "Living area unknown",
  main_area: "Living area unknown",
  hood_turnover: "Neighborhood signal",
  zip_turnover: "Zip-level signal",
  hood_median_tenure: "Neighborhood signal",
  hood_n: "Neighborhood size",
  log_market_value: "Market value",
  land_share: "Land share",
  cap_ratio: "Homestead-cap signal",
  legal_acreage: "Lot size",
};

function cleanLabel(label: string): string {
  if (RAW_LABELS[label]) return RAW_LABELS[label];
  return label
    .replace(/Neighborhood (nan|UNK)/i, "Neighborhood signal")
    .replace(/Zip (nan|UNK)/i, "Zip-level signal");
}

type OwnerKey = "ALL" | "OWNER_OCCUPIED" | "ABSENTEE" | "ENTITY";
type SortKey = "score" | "value" | "tenure" | "velocity";

const FILTERS: { key: OwnerKey; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "OWNER_OCCUPIED", label: "Owner-occ" },
  { key: "ABSENTEE", label: "Absentee" },
  { key: "ENTITY", label: "Entity" },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: "score", label: "List likelihood" },
  { key: "value", label: "Est. value" },
  { key: "tenure", label: "Tenure" },
  { key: "velocity", label: "Recently moved" },
];

const VISIBLE = 80; // keep the rendered list snappy; filters narrow from the full set

export function SellerBoard({ properties }: { properties: ScoredProperty[] }) {
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState<OwnerKey>("ALL");
  const [sort, setSort] = useState<SortKey>("score");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = properties.filter((p) => {
      if (owner !== "ALL" && p.ownerType !== owner) return false;
      if (!q) return true;
      return (
        p.addressLine1.toLowerCase().includes(q) ||
        (p.ownerName ?? "").toLowerCase().includes(q) ||
        p.zip.includes(q)
      );
    });
    out = [...out].sort((a, b) => {
      if (sort === "value")
        return Number(BigInt(b.avmEstimateCents ?? "0") - BigInt(a.avmEstimateCents ?? "0"));
      if (sort === "tenure")
        return (b.ownershipTenureMonths ?? -1) - (a.ownershipTenureMonths ?? -1);
      if (sort === "velocity") return (b.velocity ?? 0) - (a.velocity ?? 0);
      return b.probabilityListMonths - a.probabilityListMonths;
    });
    return out;
  }, [properties, query, owner, sort]);

  return (
    <>
      <div className="toolbar">
        <div className="search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search address, owner, or zip"
            aria-label="Search properties"
          />
        </div>

        <div className="toolbar-right">
          <div className="segmented" role="group" aria-label="Filter by owner type">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={owner === f.key ? "on" : ""}
                onClick={() => setOwner(f.key)}
                type="button"
              >
                {f.label}
              </button>
            ))}
          </div>
          <label className="sort">
            <span>Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="result-line">
        {rows.length} {rows.length === 1 ? "property" : "properties"}
        {owner !== "ALL" && ` · ${FILTERS.find((f) => f.key === owner)?.label}`}
        {query && ` · matching "${query}"`}
        {rows.length > VISIBLE && ` · showing top ${VISIBLE}`}
      </div>

      <div className="row-head">
        <span>#</span>
        <span>Score</span>
        <span>Property</span>
        <span>Owner</span>
        <span style={{ textAlign: "right" }}>Est · Tenure</span>
        <span>Why it fired</span>
      </div>

      <div className="list">
        {rows.slice(0, VISIBLE).map((p, i) => {
          const s = listScore(p);
          const c = heat(s);
          const o = OWNER[p.ownerType ?? ""] ?? { cls: "entity", label: "—" };
          return (
            <article
              key={p.id}
              className={`row${s >= 65 ? " priority" : ""}`}
              style={{ ["--heat" as string]: c }}
            >
              <span className="rank">{String(i + 1).padStart(2, "0")}</span>

              <div className="score-cell">
                <span className="score-num">
                  {s}
                  <span className="pct">P·24mo</span>
                </span>
                <span className="score-bar">
                  <span style={{ width: `${s}%` }} />
                </span>
              </div>

              <div className="addr-cell">
                <div className="addr">
                  {titleCase(p.addressLine1)}
                  {p.velocity >= 1 && (
                    <span className="vel" title="score jump from a new event">▲ +{Math.round(p.velocity)}</span>
                  )}
                </div>
                <div className="addr-sub">{p.ownerName ? titleCase(p.ownerName) : "Owner unknown"}</div>
              </div>

              <div className="pill-cell">
                <span className={`pill ${o.cls}`}>{o.label}</span>
              </div>

              <div className="metrics">
                <div className="metric-val">{money(p.avmEstimateCents)}</div>
                <div className="metric-lab">
                  {tenure(p.ownershipTenureMonths)} owned · {p.zip}
                </div>
              </div>

              <div className="factors">
                {(p.factors ?? []).slice(0, 3).map((f, j) => (
                  <span key={j} className={`chip ${f.direction}`} title={`weight ${f.weight}`}>
                    <span className="arrow">{f.direction === "up" ? "▲" : "▼"}</span>
                    {cleanLabel(f.label)}
                  </span>
                ))}
              </div>
            </article>
          );
        })}

        {rows.length === 0 && (
          <div className="empty">No properties match — clear the search or filter.</div>
        )}
      </div>
    </>
  );
}
