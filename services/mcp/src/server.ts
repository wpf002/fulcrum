/**
 * Fulcrum MCP server (Prophet pattern) — plugs Fulcrum's scores + matches into
 * agent workflows (Claude, Cursor, others). Exposes:
 *   - fulcrum_score : a property's list-likelihood + why it fired
 *   - fulcrum_match : an agent's warm-buyer ↔ likely-to-list-home matches
 *   - fulcrum_track_record : the model's validated accuracy
 *
 * Talks to the Fulcrum API via @fulcrum/client. Stdio transport, so any MCP
 * host can spawn it: `tsx src/server.ts` (set FULCRUM_API_URL).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { FulcrumClient, type Factor } from "@fulcrum/client";

const client = new FulcrumClient(process.env.FULCRUM_API_URL);

function usd(cents: string | null): string {
  if (!cents) return "—";
  return `$${Math.round(Number(BigInt(cents) / 100n) / 1000)}K`;
}
function factorLine(f: Factor): string {
  return `${f.direction === "up" ? "▲" : "▼"} ${f.label}`;
}
function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: "fulcrum", version: "0.1.0" });

  server.registerTool(
    "fulcrum_score",
    {
      title: "Score a property",
      description:
        "Get a property's likelihood-to-list score (0–100), the calibrated probability of a sale within 24 months, recency events (probate, etc.), and the factors that drove the score. Input is a Fulcrum property id (e.g. trav-000000509539).",
      inputSchema: { propertyId: z.string().describe("Fulcrum property id, e.g. trav-000000509539") },
    },
    async ({ propertyId }) => {
      const p = await client.propertyScore(propertyId);
      if (p.score == null) return text(`${p.address} (${p.zip}) has no seller score yet.`);
      const events = p.events.length ? p.events.map((e) => e.type).join(", ") : "none";
      const factors = (p.factors ?? []).slice(0, 5).map(factorLine).join("\n  ");
      return text(
        `${p.address}, ${p.city} ${p.zip}\n` +
          `List-likelihood score: ${p.score}/100 (P=${((p.probabilityListMonths ?? 0) * 100).toFixed(0)}% within 24mo)` +
          `${p.velocity ? `, recently moved +${Math.round(p.velocity)}` : ""}\n` +
          `Owner: ${p.ownerName ?? "unknown"} (${p.ownerType ?? "?"}), est. value ${usd(p.avmEstimateCents)}\n` +
          `Events: ${events}\n` +
          `Why:\n  ${factors}\n` +
          `Model: ${p.modelVersion ?? "n/a"}`,
      );
    },
  );

  server.registerTool(
    "fulcrum_match",
    {
      title: "Buyer↔home matches for an agent",
      description:
        "Return an agent's top matches — warm consented buyers paired with likely-to-list homes in their budget and territory, ranked by matchScore (criteriaFit × list-likelihood × buyer readiness). The door-knock queue.",
      inputSchema: {
        agentId: z.string().describe("Fulcrum agent id"),
        limit: z.number().int().min(1).max(25).optional().describe("max matches (default 8)"),
      },
    },
    async ({ agentId, limit }) => {
      const matches = await client.matches(agentId);
      const top = matches.slice(0, limit ?? 8);
      if (!top.length) return text("No matches for this agent yet.");
      const lines = top.map((m, i) => {
        const probate = m.property.eventTypes.includes("PROBATE") ? " [PROBATE]" : "";
        return (
          `${i + 1}. match ${Math.round(m.matchScore * 100)} — ${m.buyer.name} → ${m.property.address} (${m.property.zip})${probate}\n` +
          `   ${usd(m.property.avmEstimateCents)} · seller score ${m.property.sellerScore ?? "—"} · buyer readiness ${m.buyer.readinessScore} · ${m.status}`
        );
      });
      return text(`Top ${top.length} matches:\n\n${lines.join("\n")}`);
    },
  );

  server.registerTool(
    "fulcrum_track_record",
    {
      title: "Model track record",
      description:
        "The seller model's validated accuracy: top-decile lift against confirmed sales, average days from flag to sale, and the latest retrain decision.",
      inputSchema: {},
    },
    async () => {
      const tr = await client.trackRecord();
      const t = (tr.track ?? {}) as Record<string, unknown>;
      const r = tr.latestRetrain as Record<string, unknown> | null;
      return text(
        `Validated top-decile lift: ${t.lift_at_top_decile ?? "—"}×  (${tr.db.confirmedSales} confirmed sales)\n` +
          `Avg days flag → sale: ${t.avg_days_to_sale ?? "—"}\n` +
          `Closed via tracked buyer: ${tr.db.viaTrackedBuyer}\n` +
          (r ? `Latest retrain: ${r.version} — ${r.shipped ? "SHIPPED" : "held"} (${r.candidate_lift}× vs incumbent)` : ""),
      );
    },
  );

  return server;
}

async function main() {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
  // stdio server: logging must go to stderr, never stdout (that's the channel)
  console.error("fulcrum-mcp ready (stdio)");
}

// run only when invoked directly (not when imported by the smoke test)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
