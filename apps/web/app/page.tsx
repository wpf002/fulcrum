import { Sidebar } from "./sidebar";
import { SellerBoard, type ScoredProperty } from "./seller-board";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3011";

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
      ? fetch(`${API}/v1/properties?zips=${zips.join(",")}&limit=500`, { cache: "no-store" }).then((r) => r.json())
      : Promise.resolve([]),
    fetch(`${API}/v1/properties/stats`, { cache: "no-store" }).then((r) => r.json()),
  ]);
  return { agent, zips, properties, stats };
}

export default async function Home() {
  const { agent, zips, properties, stats } = await getData();
  const priorityCount = properties.filter((p) => Math.round(p.probabilityListMonths * 100) >= 65).length;

  return (
    <div className="app">
      <Sidebar active="sellers" />

      <main className="main">
        <header className="appbar">
          <div className="appbar-titles">
            <h1>Likely sellers</h1>
            <span className="appbar-sub">
              {agent ? agent.name : "No agent"} · Travis County farm
            </span>
          </div>
          <div className="appbar-meta">
            <span className="territory-chip">
              <span className="dot" /> {zips.join(" · ")}
            </span>
            <span className="freshness-inline">
              TCAD roll <b>Jul 2025</b> · model phase0-v1
            </span>
          </div>
        </header>

        <div className="content">
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

          <SellerBoard properties={properties} />

          <p className="foot">
            Score = P(market sale within 24 months), Phase 0 LightGBM on public TCAD records.
            Every score ships with <span className="accent">factor provenance</span> — no black box.
            Quarantined identity matches are never surfaced.
          </p>
        </div>
      </main>
    </div>
  );
}
