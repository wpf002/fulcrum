import { Sidebar } from "../sidebar";
import { apiGet } from "../../lib/api";
import { titleCase } from "../../lib/format";

interface TrackRecord {
  track: {
    model_version?: string;
    evaluated_window?: string;
    n_predictions?: number;
    base_rate?: number;
    precision_at_top_decile?: number;
    lift_at_top_decile?: number;
    avg_days_to_sale?: number;
    median_days_to_sale?: number;
    top_predictive_factors?: { factor: string; importance: number }[];
  } | null;
  latestRetrain: {
    version: string;
    trained_at: string;
    training_rows: number;
    new_outcomes_folded_in: number;
    holdout_base_rate: number;
    incumbent_p10: number;
    candidate_p10: number;
    candidate_lift: number;
    shipped: boolean;
    vs_incumbent: string;
  } | null;
  db: {
    confirmedSales: number;
    viaTrackedBuyer: number;
    recent: {
      id: string;
      address: string;
      zip: string;
      soldAt: string;
      predictedScore: number | null;
      salePriceCents: string;
      viaTrackedBuyer: boolean;
    }[];
  };
}

export const dynamic = "force-dynamic";

async function getData(): Promise<TrackRecord> {
  return apiGet<TrackRecord>("/v1/model/track-record");
}

function money(cents: string): string {
  return `$${Math.round(Number(BigInt(cents) / 100n) / 1000)}K`;
}
function fdate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function Outcomes() {
  const { track, latestRetrain, db } = await getData();
  const t = track ?? {};
  const factors = t.top_predictive_factors ?? [];
  const maxImp = factors.length ? factors[0].importance : 1;
  const incLift = latestRetrain ? +(latestRetrain.incumbent_p10 / latestRetrain.holdout_base_rate).toFixed(2) : null;

  return (
    <div className="app">
      <Sidebar active="outcomes" />

      <main className="main">
        <header className="appbar">
          <div className="appbar-titles">
            <h1>Results</h1>
            <span className="appbar-sub">How past predictions actually turned out</span>
          </div>
        </header>

        <div className="content">
          <section className="kpis">
            <div className="kpi headline">
              <div className="kpi-label">Model accuracy</div>
              <div className="kpi-value">{t.lift_at_top_decile ?? "—"}×</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Confirmed sales</div>
              <div className="kpi-value">{db.confirmedSales.toLocaleString()}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Avg days to sale</div>
              <div className="kpi-value">{t.avg_days_to_sale ?? "—"}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Closed with our buyers</div>
              <div className="kpi-value">{db.viaTrackedBuyer}</div>
            </div>
          </section>

          <div className="tr-grid">
            {/* confirmed sales feed the next model update */}
            {latestRetrain && (
              <section className="tr-card retrain">
                <div className="tr-head">
                  <h2>Latest model update</h2>
                  <span className={`ship-tag ${latestRetrain.shipped ? "ship" : "hold"}`}>
                    {latestRetrain.shipped ? "Live" : "On hold"}
                  </span>
                </div>
                <p className="tr-note">
                  {latestRetrain.new_outcomes_folded_in.toLocaleString()} newly confirmed sales were added to
                  training. A new model only goes live if it beats the current one on sales it hasn't seen.
                </p>
                <div className="retrain-compare">
                  <div className="rc-col">
                    <span className="rc-lab">Current</span>
                    <span className="rc-num">{incLift}×</span>
                    <span className="rc-ver">{latestRetrain.vs_incumbent}</span>
                  </div>
                  <div className="rc-arrow">→</div>
                  <div className="rc-col win">
                    <span className="rc-lab">New</span>
                    <span className="rc-num">{latestRetrain.candidate_lift}×</span>
                    <span className="rc-ver">{latestRetrain.version}</span>
                  </div>
                </div>
              </section>
            )}

            {/* what the model weighs most */}
            <section className="tr-card">
              <div className="tr-head"><h2>What predicts a sale</h2></div>
              <div className="factor-bars">
                {factors.map((f) => (
                  <div key={f.factor} className="fbar">
                    <span className="fbar-label">{f.factor}</span>
                    <span className="fbar-track">
                      <span className="fbar-fill" style={{ width: `${(f.importance / maxImp) * 100}%` }} />
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="section-head">
            <h2>Recent confirmed sales</h2>
            <span className="count">checked against county records</span>
          </div>

          <div className="row-head outcome-head">
            <span>Sold</span>
            <span>Property</span>
            <span style={{ textAlign: "right" }}>Recorded</span>
            <span style={{ textAlign: "right" }}>Our score</span>
            <span>Source</span>
          </div>
          <div className="list">
            {db.recent.map((o) => (
              <article key={o.id} className="row outcome-row">
                <div className="metric-val">{fdate(o.soldAt)}</div>
                <div className="addr-cell">
                  <div className="addr">
                    {titleCase(o.address)}
                    {o.viaTrackedBuyer && <span className="ev-badge">Tracked buyer</span>}
                  </div>
                  <div className="addr-sub">{o.zip}</div>
                </div>
                <div className="metrics"><div className="metric-val">{money(o.salePriceCents)}</div></div>
                <div className="metrics">
                  <div className="metric-val" style={{ color: (o.predictedScore ?? 0) >= 30 ? "#c1372b" : "var(--muted)" }}>
                    score {o.predictedScore ?? "—"}
                  </div>
                </div>
                <div className="addr-sub">County deed record</div>
              </article>
            ))}
          </div>

          <p className="foot">
            Each confirmed sale is compared against what we predicted, and feeds the next model update.
            Texas doesn't make sale prices public, so the amount shown is an estimate — the sale itself
            and its date come from county records.
          </p>
        </div>
      </main>
    </div>
  );
}
