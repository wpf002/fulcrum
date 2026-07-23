import { Sidebar } from "../sidebar";
import { apiGet, getMe } from "../../lib/api";

interface Consent {
  termsVersion: string;
  termsHash: string | null;
  capturedAt: string;
  channelOptIns: { email: boolean; sms: boolean; tcpa: boolean };
  toolSource: string;
  ip: string | null;
  userAgent: string | null;
}

interface Lead {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  priceBandMinCents: string | null;
  priceBandMaxCents: string | null;
  targetGeographies: string[];
  minBeds: number | null;
  affordabilityResultCents: string | null;
  mortgageReadinessAnswers: { preApproved?: boolean; downPaymentSaved?: boolean } | null;
  timelineMonths: number | null;
  readinessScore: number;
  source: string;
  createdAt: string;
  consent: Consent;
}

export const dynamic = "force-dynamic";

async function getData() {
  const [agent, leads] = await Promise.all([getMe(), apiGet<Lead[]>("/v1/me/leads")]);
  return { agent, leads };
}

function money(cents: string | null): string {
  if (!cents) return "—";
  return `$${Math.round(Number(BigInt(cents) / 100n) / 1000)}K`;
}

function band(min: string | null, max: string | null): string {
  if (!max) return "—";
  return `${money(min)}–${money(max)}`;
}

function timeline(m: number | null): string {
  if (m == null) return "—";
  if (m <= 3) return "≤ 3 mo";
  if (m <= 6) return "3–6 mo";
  if (m <= 12) return "6–12 mo";
  return "exploring";
}

function readyColor(score: number): string {
  if (score >= 80) return "#c1372b";
  if (score >= 60) return "#d96a3a";
  if (score >= 40) return "#c08a2e";
  return "#5b6b7a";
}

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default async function Leads() {
  const { agent, leads } = await getData();
  const hot = leads.filter((l) => l.readinessScore >= 60).length;
  const consentedSms = leads.filter((l) => l.consent.channelOptIns.sms).length;

  return (
    <div className="app">
      <Sidebar active="leads" agentName={agent.name} />

      <main className="main">
        <header className="appbar">
          <div className="appbar-titles">
            <h1>Buyer leads</h1>
            <span className="appbar-sub">{agent ? agent.name : "No agent"} · consented inbound</span>
          </div>
          <div className="appbar-meta">
            <span className="freshness-inline">
              100% opt-in · every lead carries a <b>consent record</b>
            </span>
          </div>
        </header>

        <div className="content">
          <section className="kpis">
            <div className="kpi headline">
              <div className="kpi-label">Leads captured</div>
              <div className="kpi-value">{leads.length}</div>
              <div className="kpi-sub">first-party, consented</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">High readiness</div>
              <div className="kpi-value">{hot}</div>
              <div className="kpi-sub">score ≥ 60 · call first</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">SMS-consented</div>
              <div className="kpi-value">{consentedSms}</div>
              <div className="kpi-sub">textable per opt-in</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Source</div>
              <div className="kpi-value" style={{ fontSize: 20 }}>Widget</div>
              <div className="kpi-sub">affordability tool</div>
            </div>
          </section>

          <div className="row-head leads-head">
            <span>Readiness</span>
            <span>Buyer</span>
            <span>Budget · Timeline</span>
            <span>Consent</span>
            <span style={{ textAlign: "right" }}>Captured</span>
          </div>

          <div className="list">
            {leads.map((l) => {
              const opt = l.consent.channelOptIns;
              return (
                <article key={l.id} className="row lead-row" style={{ ["--heat" as string]: readyColor(l.readinessScore) }}>
                  <div className="score-cell">
                    <span className="score-num">
                      {l.readinessScore}
                      <span className="pct">/100</span>
                    </span>
                    <span className="score-bar">
                      <span style={{ width: `${l.readinessScore}%` }} />
                    </span>
                  </div>

                  <div className="addr-cell">
                    <div className="addr">
                      {[l.firstName, l.lastName].filter(Boolean).join(" ") || "Anonymous buyer"}
                    </div>
                    <div className="addr-sub">
                      {l.email ?? "no email"}
                      {l.phone ? ` · ${l.phone}` : ""}
                    </div>
                  </div>

                  <div className="lead-budget">
                    <div className="metric-val">{band(l.priceBandMinCents, l.priceBandMaxCents)}</div>
                    <div className="metric-lab">
                      {timeline(l.timelineMonths)}
                      {l.minBeds ? ` · ${l.minBeds}+ bd` : ""}
                      {l.targetGeographies[0] ? ` · ${l.targetGeographies[0]}` : ""}
                    </div>
                  </div>

                  <div className="consent-cell">
                    <span className={`ch ${opt.email ? "on" : ""}`}>Email</span>
                    <span className={`ch ${opt.sms ? "on" : ""}`}>SMS</span>
                    <span className={`ch ${opt.tcpa ? "on" : ""}`}>TCPA</span>
                    {l.mortgageReadinessAnswers?.preApproved && <span className="ch flag">Pre-approved</span>}
                  </div>

                  <div className="metrics">
                    <div className="metric-val">{ago(l.createdAt)}</div>
                    <div
                      className="metric-lab"
                      title={
                        `Consent receipt\nterms ${l.consent.termsVersion}` +
                        `\nsha256 ${l.consent.termsHash ?? "—"}` +
                        `\ncaptured ${new Date(l.consent.capturedAt).toISOString()}` +
                        `\nip ${l.consent.ip ?? "—"}` +
                        `\nua ${l.consent.userAgent ?? "—"}`
                      }
                    >
                      terms v{l.consent.termsVersion}
                      {l.consent.termsHash && ` · ${l.consent.termsHash.slice(0, 8)}`}
                    </div>
                  </div>
                </article>
              );
            })}

            {leads.length === 0 && (
              <div className="empty">
                No leads yet. Embed the buyer widget on your site — open{" "}
                <a
                  href={`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3011"}/widget/demo`}
                  style={{ color: "var(--accent)" }}
                >
                  the demo landing page
                </a>{" "}
                and complete it to see one land here.
              </div>
            )}
          </div>

          <p className="foot">
            Every lead is tied to an immutable <span className="accent">consent record</span> (terms version,
            channel opt-ins, capture time) — no consent, no lead. Readiness is a rules-based score;
            the ML model comes in a later phase.
          </p>
        </div>
      </main>
    </div>
  );
}
