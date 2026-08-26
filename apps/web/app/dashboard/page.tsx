import { Sidebar } from "../sidebar";
import { apiGet, getMe } from "../../lib/api";
import { titleCase } from "../../lib/format";

interface Factor { label: string; weight: number; direction: "up" | "down" }

interface ScoredProperty {
  id: string;
  addressLine1: string;
  zip: string;
  ownerName: string | null;
  probabilityListMonths: number;
  velocity: number;
  factors: Factor[];
}

interface Lead {
  id: string;
  firstName: string | null;
  lastName: string | null;
  readinessScore: number;
  timelineMonths: number | null;
  priceBandMaxCents: string | null;
  createdAt: string;
}

interface Match {
  id: string;
  matchScore: number;
  status: string;
  buyer: { id: string; name: string };
  property: { address: string; zip: string; avmEstimateCents: string | null };
}

interface Summary { surfaced: number; buyers: number; properties: number }
interface TrackRecord {
  track: { lift_at_top_decile?: number; avg_days_to_sale?: number } | null;
  db: { confirmedSales: number };
}

export const dynamic = "force-dynamic";

async function getData() {
  const [agent, properties, leads, matches, summary, results] = await Promise.all([
    getMe(),
    apiGet<ScoredProperty[]>("/v1/me/properties?limit=200"),
    apiGet<Lead[]>("/v1/me/leads"),
    apiGet<Match[]>("/v1/me/matches"),
    apiGet<Summary>("/v1/me/matches/summary"),
    apiGet<TrackRecord>("/v1/model/track-record"),
  ]);
  return { agent, properties, leads, matches, summary, results };
}

function money(cents: string | null): string {
  if (!cents) return "—";
  const d = Number(BigInt(cents) / 100n);
  return d >= 1_000_000 ? `$${(d / 1_000_000).toFixed(2)}M` : `$${Math.round(d / 1000)}K`;
}

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default async function Dashboard() {
  const { agent, properties, leads, matches, summary, results } = await getData();

  const score = (p: ScoredProperty) => Math.round(p.probabilityListMonths * 100);
  const highPriority = properties.filter((p) => score(p) >= 65).length;
  const readyBuyers = leads.filter((l) => l.readinessScore >= 60).length;
  const topMatches = matches.filter((m) => m.status === "SURFACED").slice(0, 5);
  const topHomes = [...properties].sort((a, b) => b.probabilityListMonths - a.probabilityListMonths).slice(0, 5);
  const recentLeads = [...leads]
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 5);

  return (
    <div className="app">
      <Sidebar active="dashboard" agentName={agent.name} />

      <main className="main">
        <header className="appbar">
          <div className="appbar-titles">
            <h1>Dashboard</h1>
            <span className="appbar-sub">Where things stand today</span>
          </div>
        </header>

        <div className="content">
          <section className="kpis">
            <div className="kpi headline">
              <div className="kpi-label">Homes to work</div>
              <div className="kpi-value">{highPriority}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Buyers ready</div>
              <div className="kpi-value">{readyBuyers}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Matches waiting</div>
              <div className="kpi-value">{summary.surfaced}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Model accuracy</div>
              <div className="kpi-value">{results.track?.lift_at_top_decile ?? "—"}×</div>
            </div>
          </section>

          <div className="dash-grid">
            <section className="dash-card">
              <div className="dash-head">
                <h2>Start Here</h2>
                <a href="/matches">All matches →</a>
              </div>
              {topMatches.length ? (
                <ul className="dash-list">
                  {topMatches.map((m) => (
                    <li key={m.id}>
                      <span className="dash-score">{Math.round(m.matchScore * 100)}</span>
                      <span className="dash-main">
                        <b>{titleCase(m.buyer.name)}</b> → {titleCase(m.property.address)}
                      </span>
                      <span className="dash-meta">{money(m.property.avmEstimateCents)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dash-empty">No matches waiting.</p>
              )}
            </section>

            <section className="dash-card">
              <div className="dash-head">
                <h2>Newest Leads</h2>
                <a href="/leads">All leads →</a>
              </div>
              {recentLeads.length ? (
                <ul className="dash-list">
                  {recentLeads.map((l) => (
                    <li key={l.id}>
                      <span className="dash-score">{l.readinessScore}</span>
                      <span className="dash-main">
                        <b>{titleCase([l.firstName, l.lastName].filter(Boolean).join(" ")) || "Anonymous"}</b>
                        {l.priceBandMaxCents ? ` · up to ${money(l.priceBandMaxCents)}` : ""}
                      </span>
                      <span className="dash-meta">{ago(l.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dash-empty">No leads yet.</p>
              )}
            </section>

            <section className="dash-card">
              <div className="dash-head">
                <h2>Most Likely to Sell</h2>
                <a href="/">All homes →</a>
              </div>
              <ul className="dash-list">
                {topHomes.map((p) => (
                  <li key={p.id}>
                    <span className="dash-score">{score(p)}</span>
                    <span className="dash-main">
                      <b>{titleCase(p.addressLine1)}</b> · {p.zip}
                    </span>
                    <span className="dash-meta">
                      {p.velocity >= 1 ? `▲ +${Math.round(p.velocity)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="dash-card">
              <div className="dash-head">
                <h2>How We&apos;re Doing</h2>
                <a href="/outcomes">Results →</a>
              </div>
              <ul className="dash-list plain">
                <li><span className="dash-main">Sales confirmed so far</span><span className="dash-meta">{results.db.confirmedSales.toLocaleString()}</span></li>
                <li><span className="dash-main">Average days to sale</span><span className="dash-meta">{results.track?.avg_days_to_sale ?? "—"}</span></li>
                <li><span className="dash-main">Buyers with matches</span><span className="dash-meta">{summary.buyers}</span></li>
                <li><span className="dash-main">Homes matched</span><span className="dash-meta">{summary.properties}</span></li>
              </ul>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
