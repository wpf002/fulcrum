import { Sidebar } from "./sidebar";
import { SellerBoard, type ScoredProperty } from "./seller-board";
import { apiGet, getMe } from "../lib/api";

interface Stats {
  total: number;
  resolved: number;
  quarantined: number;
  scored: number;
}

export const dynamic = "force-dynamic";

async function getData() {
  const agent = await getMe();
  const zips = agent.territories?.zips ?? [];
  const [properties, stats] = await Promise.all([
    apiGet<ScoredProperty[]>("/v1/me/properties?limit=500"),
    apiGet<Stats>("/v1/properties/stats"),
  ]);
  return { agent, zips, properties, stats };
}

export default async function Home() {
  const { agent, zips, properties, stats } = await getData();
  const priorityCount = properties.filter((p) => Math.round(p.probabilityListMonths * 100) >= 65).length;

  return (
    <div className="app">
      <Sidebar active="sellers" agentName={agent.name} />

      <main className="main">
        <header className="appbar">
          <div className="appbar-titles">
            <h1>Likely Sellers</h1>
            <span className="appbar-sub">Travis County</span>
          </div>
          <div className="appbar-meta">
            <span className="territory-chip">
              <span className="dot" /> {zips.join(" · ")}
            </span>
          </div>
        </header>

        <div className="content">
          <section className="kpis">
            <div className="kpi headline">
              <div className="kpi-label">Model accuracy</div>
              <div className="kpi-value">1.97×</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Homes scored</div>
              <div className="kpi-value">{stats.scored.toLocaleString()}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">High priority</div>
              <div className="kpi-value">{priorityCount}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Needs review</div>
              <div className="kpi-value">{stats.quarantined.toLocaleString()}</div>
            </div>
          </section>

          <SellerBoard properties={properties} />

          <p className="foot">
            Each score estimates how likely a home is to sell in the next two years, based on
            public county records. Every score lists the reasons behind it. Homes we couldn't
            confidently identify are left out rather than guessed at.
          </p>
        </div>
      </main>
    </div>
  );
}
