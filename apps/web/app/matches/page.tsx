import { Sidebar } from "../sidebar";
import { MatchesBoard, type Match } from "../matches-board";
import { apiGet, getMe } from "../../lib/api";

interface Summary {
  surfaced: number;
  buyers: number;
  properties: number;
}

export const dynamic = "force-dynamic";

async function getData() {
  const [agent, matches, summary] = await Promise.all([
    getMe(),
    apiGet<Match[]>("/v1/me/matches"),
    apiGet<Summary>("/v1/me/matches/summary"),
  ]);
  return { agent, matches, summary };
}

export default async function Matches() {
  const { agent, matches, summary } = await getData();
  const topScore = matches.length ? Math.round(matches[0].matchScore * 100) : 0;

  return (
    <div className="app">
      <Sidebar active="matches" agentName={agent.name} />

      <main className="main">
        <header className="appbar">
          <div className="appbar-titles">
            <h1>Matches</h1>
            <span className="appbar-sub">{agent ? agent.name : "No agent"} · both pipes flowing</span>
          </div>
          <div className="appbar-meta">
            <span className="freshness-inline">
              warm buyers <b>×</b> likely-to-list homes, in your territory
            </span>
          </div>
        </header>

        <div className="content">
          <section className="kpis">
            <div className="kpi headline">
              <div className="kpi-label">Best match</div>
              <div className="kpi-value">{topScore}</div>
              <div className="kpi-sub">criteria × list-likelihood × readiness</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Warm buyers</div>
              <div className="kpi-value">{summary.buyers}</div>
              <div className="kpi-sub">consented, with matches</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Homes matched</div>
              <div className="kpi-value">{summary.properties}</div>
              <div className="kpi-sub">likely-to-list, in budget + zip</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">To action</div>
              <div className="kpi-value">{summary.surfaced}</div>
              <div className="kpi-sub">surfaced · not yet worked</div>
            </div>
          </section>

          <MatchesBoard matches={matches} />

          <p className="foot">
            matchScore = <span className="accent">criteriaFit</span> (geo × price) ×{" "}
            <span className="accent">listLikelihood</span> (seller model) ×{" "}
            <span className="accent">buyerReadiness</span>. Only possible because Fulcrum owns both
            ends of the transaction — this is the moat.
          </p>
        </div>
      </main>
    </div>
  );
}
