"use client";

import { useMemo, useState } from "react";

interface Factor {
  label: string;
  weight: number;
  direction: "up" | "down";
}

export interface Match {
  id: string;
  matchScore: number;
  status: "SURFACED" | "CONTACTED" | "DISMISSED" | "CONVERTED";
  factors: Factor[];
  buyer: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    readinessScore: number;
    priceBandMinCents: string | null;
    priceBandMaxCents: string | null;
    timelineMonths: number | null;
  };
  property: {
    id: string;
    address: string;
    zip: string;
    ownerName: string | null;
    ownerType: string | null;
    avmEstimateCents: string | null;
    sellerScore: number | null;
    eventTypes: string[];
  };
}

function money(cents: string | null): string {
  if (!cents) return "—";
  return `$${Math.round(Number(BigInt(cents) / 100n) / 1000)}K`;
}

function band(lo: string | null, hi: string | null): string {
  if (!hi) return "—";
  return `${money(lo)}–${money(hi)}`;
}

function timeline(m: number | null): string {
  if (m == null) return "—";
  if (m <= 3) return "≤3mo";
  if (m <= 6) return "3–6mo";
  if (m <= 12) return "6–12mo";
  return "exploring";
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bLlc\b/g, "LLC");
}

function strength(score: number): string {
  const v = score * 100;
  if (v >= 70) return "#c1372b";
  if (v >= 50) return "#d96a3a";
  if (v >= 30) return "#c08a2e";
  return "#8a8f68";
}

export function MatchesBoard({ matches: initial }: { matches: Match[] }) {
  const [matches, setMatches] = useState(initial);
  const [showDismissed, setShowDismissed] = useState(false);

  async function setStatus(id: string, status: Match["status"]) {
    setMatches((ms) => ms.map((m) => (m.id === id ? { ...m, status } : m)));
    try {
      await fetch(`/api/matches/${id}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
    } catch {
      /* optimistic; ignore transient errors */
    }
  }

  // group by buyer, ranked by the buyer's single best match
  const groups = useMemo(() => {
    const visible = matches.filter((m) => showDismissed || m.status !== "DISMISSED");
    const byBuyer = new Map<string, Match[]>();
    for (const m of visible) {
      const arr = byBuyer.get(m.buyer.id) ?? [];
      arr.push(m);
      byBuyer.set(m.buyer.id, arr);
    }
    return [...byBuyer.values()]
      .map((ms) => ms.sort((a, b) => b.matchScore - a.matchScore))
      .sort((a, b) => b[0].matchScore - a[0].matchScore);
  }, [matches, showDismissed]);

  return (
    <>
      <div className="toolbar">
        <div className="section-head" style={{ margin: 0 }}>
          <h2 style={{ fontSize: 17 }}>Door-knock queue</h2>
          <span className="count">warm buyers × likely-to-list homes</span>
        </div>
        <label className="sort">
          <input
            type="checkbox"
            checked={showDismissed}
            onChange={(e) => setShowDismissed(e.target.checked)}
          />
          <span>show dismissed</span>
        </label>
      </div>

      <div className="match-groups">
        {groups.map((group) => {
          const b = group[0].buyer;
          return (
            <section key={b.id} className="match-group">
              <header className="buyer-head">
                <div className="buyer-id">
                  <span className="buyer-name">{b.name}</span>
                  <span className="buyer-meta">
                    {band(b.priceBandMinCents, b.priceBandMaxCents)} · {timeline(b.timelineMonths)} ·{" "}
                    readiness <b>{b.readinessScore}</b>
                  </span>
                </div>
                <div className="buyer-contact">
                  {b.email && <span>{b.email}</span>}
                  {b.phone && <span>{b.phone}</span>}
                </div>
              </header>

              <div className="match-list">
                {group.map((m) => {
                  const probate = m.property.eventTypes.includes("PROBATE");
                  return (
                    <article
                      key={m.id}
                      className={`match-row${m.status === "DISMISSED" ? " dim" : ""}`}
                      style={{ ["--heat" as string]: strength(m.matchScore) }}
                    >
                      <div className="match-strength">
                        <span className="ms-num">{Math.round(m.matchScore * 100)}</span>
                        <span className="ms-lab">match</span>
                      </div>

                      <div className="match-prop">
                        <div className="addr">
                          {titleCase(m.property.address)}
                          {probate && <span className="ev-badge">Probate</span>}
                        </div>
                        <div className="addr-sub">
                          {m.property.zip} · {money(m.property.avmEstimateCents)} ·{" "}
                          {m.property.ownerName ? titleCase(m.property.ownerName) : "owner unknown"} · seller score{" "}
                          {m.property.sellerScore ?? "—"}
                        </div>
                      </div>

                      <div className="match-why">
                        {m.factors.slice(0, 4).map((f, i) => (
                          <span key={i} className={`chip ${f.direction}`}>
                            {f.label}
                          </span>
                        ))}
                      </div>

                      <div className="match-actions">
                        {m.status === "SURFACED" && (
                          <>
                            <button className="act primary" onClick={() => setStatus(m.id, "CONTACTED")}>
                              Contacted
                            </button>
                            <button className="act ghost" onClick={() => setStatus(m.id, "DISMISSED")}>
                              Dismiss
                            </button>
                          </>
                        )}
                        {m.status === "CONTACTED" && <span className="status-tag contacted">✓ Contacted</span>}
                        {m.status === "CONVERTED" && <span className="status-tag converted">Converted</span>}
                        {m.status === "DISMISSED" && (
                          <button className="act ghost" onClick={() => setStatus(m.id, "SURFACED")}>
                            Restore
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}

        {groups.length === 0 && (
          <div className="empty">
            No matches yet. Capture buyer leads and run the match engine
            (<code>pnpm --filter @fulcrum/ingest match batch</code>).
          </div>
        )}
      </div>
    </>
  );
}
