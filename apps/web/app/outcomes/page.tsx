import { Sidebar } from "../sidebar";
import { apiGet } from "../../lib/api";

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

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
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
            <h1>Model track record</h1>
            <span className="appbar-sub">confirmed sales validate the predictions · the flywheel</span>
          </div>
          <div className="appbar-meta">
            <span className="freshness-inline">{t.evaluated_window ?? "—"}</span>
          </div>
        </header>

        <div className="content">
          <section className="kpis">
            <div className="kpi headline">
              <div className="kpi-label">Validated top-decile lift</div>
              <div className="kpi-value">{t.lift_at_top_decile ?? "—"}×</div>
              <div className="kpi-sub">
                {t.precision_at_top_decile != null
                  ? `${(t.precision_at_top_decile * 100).toFixed(1)}% vs ${((t.base_rate ?? 0) * 100).toFixed(1)}% base`
                  : "against real sales"}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Confirmed sales</div>
              <div className="kpi-value">{db.confirmedSales.toLocaleString()}</div>
              <div className="kpi-sub">real deed transfers, labeled</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Avg days flag → sale</div>
              <div className="kpi-value">{t.avg_days_to_sale ?? "—"}</div>
              <div className="kpi-sub">lead time to work the door</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Closed via tracked buyer</div>
              <div className="kpi-value">{db.viaTrackedBuyer}</div>
              <div className="kpi-sub">buyer-side proof · the moat</div>
            </div>
          </section>

          <div className="tr-grid">
            {/* the flywheel: outcomes retrain the model */}
            {latestRetrain && (
              <section className="tr-card retrain">
                <div className="tr-head">
                  <h2>Latest retrain</h2>
                  <span className={`ship-tag ${latestRetrain.shipped ? "ship" : "hold"}`}>
                    {latestRetrain.shipped ? "SHIPPED" : "HELD"}
                  </span>
                </div>
                <p className="tr-note">
                  {latestRetrain.new_outcomes_folded_in.toLocaleString()} new confirmed outcomes folded into training.
                  Ships only if it beats the incumbent on a fresh holdout (kill criteria).
                </p>
                <div className="retrain-compare">
                  <div className="rc-col">
                    <span className="rc-lab">Incumbent</span>
                    <span className="rc-num">{incLift}×</span>
                    <span className="rc-ver">{latestRetrain.vs_incumbent}</span>
                  </div>
                  <div className="rc-arrow">→</div>
                  <div className="rc-col win">
                    <span className="rc-lab">Candidate</span>
                    <span className="rc-num">{latestRetrain.candidate_lift}×</span>
                    <span className="rc-ver">{latestRetrain.version}</span>
                  </div>
                </div>
              </section>
            )}

            {/* top predictive factors */}
            <section className="tr-card">
              <div className="tr-head"><h2>Top predictive factors</h2></div>
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
            <span className="count">predicted, then validated by the county recorder</span>
          </div>

          <div className="row-head outcome-head">
            <span>Sold</span>
            <span>Property</span>
            <span style={{ textAlign: "right" }}>Recorded</span>
            <span style={{ textAlign: "right" }}>We predicted</span>
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
                <div className="addr-sub">county recorder deed</div>
              </article>
            ))}
          </div>

          <p className="foot">
            SmartZip can't run this loop — they have no buyer side to confirm outcomes with. Every
            confirmed sale here re-labels a prediction and feeds the next retrain. Sale price is the AVM
            estimate (Texas is <span className="accent">non-disclosure</span>); the sale and its timing are real.
          </p>
        </div>
      </main>
    </div>
  );
}
