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
            <span className="appbar-sub">Your buyers, paired with homes likely to sell</span>
          </div>
        </header>

        <div className="content">
          <section className="kpis">
            <div className="kpi headline">
              <div className="kpi-label">Best match</div>
              <div className="kpi-value">{topScore}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Active buyers</div>
              <div className="kpi-value">{summary.buyers}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Homes matched</div>
              <div className="kpi-value">{summary.properties}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Not yet contacted</div>
              <div className="kpi-value">{summary.surfaced}</div>
            </div>
          </section>

          <MatchesBoard matches={matches} />

          <p className="foot">
            A match score combines three things: how well the home fits what the buyer asked for,
            how likely that home is to sell, and how ready the buyer is to move.
          </p>
        </div>
      </main>
    </div>
  );
}
