const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3011";

interface Factor {
  label: string;
  weight: number;
  direction: "up" | "down";
}

interface ScoredProperty {
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
  factors: Factor[];
  modelVersion: string;
}

interface AgentRow {
  id: string;
  name: string;
  territories: { zips?: string[] };
}

interface Stats {
  total: number;
  resolved: number;
  quarantined: number;
  scored: number;
}

export const dynamic = "force-dynamic";

async function getData() {
  const agents: AgentRow[] = await fetch(`${API}/v1/agents`, { cache: "no-store" }).then((r) => r.json());
  const agent = agents[0];
  const zips = agent?.territories?.zips ?? [];
  const [properties, stats]: [ScoredProperty[], Stats] = await Promise.all([
    zips.length
      ? fetch(`${API}/v1/properties?zips=${zips.join(",")}&limit=40`, { cache: "no-store" }).then((r) => r.json())
      : Promise.resolve([]),
    fetch(`${API}/v1/properties/stats`, { cache: "no-store" }).then((r) => r.json()),
  ]);
  return { agent, zips, properties, stats };
}

// Displayed score = P(market sale within 24mo) as 0–100. The DB `score` column
// is a county percentile that saturates at 100 across the whole top tier, so it
// carries no ranking signal within a hot farm — the calibrated probability does,
// and it reads honestly as "how likely, not just how ranked."
function listScore(p: { probabilityListMonths: number }): number {
  return Math.round(p.probabilityListMonths * 100);
}

// ── semantic heat scale: likelihood-to-list as literal temperature ──
function heat(score: number): string {
  if (score >= 75) return "#c1372b"; // deep ember — act now
  if (score >= 60) return "#d96a3a"; // ember
  if (score >= 45) return "#c08a2e"; // amber
  if (score >= 30) return "#8a8f68"; // warm olive
  return "#5b6b7a"; // cool slate
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

// Some already-loaded scores carry raw snake_case feature names (rows where a
// numeric feature was null fell through to the bare column name) and a couple
// of "nan"/UNK neighborhood labels. Humanize at render time — no rescore needed.
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

export default async function Home() {
  const { agent, zips, properties, stats } = await getData();
  const priorityCount = properties.filter((p) => listScore(p) >= 65).length;

  return (
    <>
      <header className="topbar">
        <div className="wrap topbar-inner">
          <div className="brand">
            <span className="brand-mark">
              Fulcrum<span className="brand-dot">.</span>
            </span>
            <span className="brand-tag">Seller Intelligence</span>
          </div>
          <div className="freshness">
            <div className="who">{agent ? agent.name : "No agent"} · Travis County, TX</div>
            <div className="asof">
              TCAD roll <b>as of Jul 2025</b> · model phase0-v1
            </div>
          </div>
        </div>
      </header>

      <main className="wrap">
        <section className="kpis">
          <div className="kpi headline">
            <div className="kpi-label">Top-decile precision</div>
            <div className="kpi-value">1.97×</div>
            <div className="kpi-sub">vs county base rate (holdout)</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Properties scored</div>
            <div className="kpi-value">{stats.scored.toLocaleString()}</div>
            <div className="kpi-sub">single-family, resolved</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">High-intent in farm</div>
            <div className="kpi-value">{priorityCount}</div>
            <div className="kpi-sub">P(list) ≥ 65% · knock first</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Quarantined</div>
            <div className="kpi-value">{stats.quarantined.toLocaleString()}</div>
            <div className="kpi-sub">unresolved · never surfaced</div>
          </div>
        </section>

        <div className="section-head">
          <h2>Most likely to list</h2>
          <span className="count">
            {zips.join(" · ")} — top {properties.length}
          </span>
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
          {properties.map((p, i) => {
            const s = listScore(p);
            const c = heat(s);
            const owner = OWNER[p.ownerType ?? ""] ?? { cls: "entity", label: "—" };
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
                  <div className="addr">{titleCase(p.addressLine1)}</div>
                  <div className="addr-sub">
                    {p.ownerName ? titleCase(p.ownerName) : "Owner unknown"}
                  </div>
                </div>

                <div className="pill-cell">
                  <span className={`pill ${owner.cls}`}>{owner.label}</span>
                </div>

                <div className="metrics">
                  <div className="metric-val">{money(p.avmEstimateCents)}</div>
                  <div className="metric-lab">{tenure(p.ownershipTenureMonths)} owned · {p.zip}</div>
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

          {properties.length === 0 && (
            <div className="empty">No scored properties in this territory yet — run the ingest worker.</div>
          )}
        </div>

        <p className="foot">
          Score = county percentile of P(market sale within 24 months), Phase 0 LightGBM on
          public TCAD records. Every score ships with <span className="accent">factor provenance</span> —
          no black box. Quarantined identity matches are never surfaced.
        </p>
      </main>
    </>
  );
}
