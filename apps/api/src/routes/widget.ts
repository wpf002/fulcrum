import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { prisma } from "@fulcrum/db";

const require = createRequire(import.meta.url);

// Resolve the built widget bundle from the workspace package.
function widgetBundlePath(): string {
  const pkg = require.resolve("@fulcrum/widget/package.json");
  return pkg.replace(/package\.json$/, "dist/fulcrum-widget.js");
}

export function registerWidgetRoutes(app: FastifyInstance) {
  // Brand + identity the embedded widget fetches on boot.
  app.get("/v1/widget/config", async (req, reply) => {
    const { agentId } = req.query as { agentId?: string };
    const agent = agentId
      ? await prisma.agent.findUnique({ where: { id: agentId } })
      : await prisma.agent.findFirst({ orderBy: { createdAt: "asc" } });
    if (!agent) return reply.code(404).send({ error: "unknown agent" });
    const brand = (agent.brandConfig ?? {}) as Record<string, unknown>;
    return reply.send({
      agentId: agent.id,
      agentName: agent.name,
      primaryColor: (brand.primaryColor as string) ?? "#1f5a46",
      logoUrl: (brand.logoUrl as string) ?? null,
      termsVersion: "2026-07-buyer-v1",
    });
  });

  // Standalone embeddable bundle. Long-cache in prod; no-cache in dev.
  app.get("/widget/fulcrum-widget.js", async (_req, reply) => {
    try {
      const js = await readFile(widgetBundlePath(), "utf8");
      return reply
        .header("content-type", "application/javascript; charset=utf-8")
        .header("cache-control", "no-cache")
        .send(js);
    } catch {
      return reply
        .code(503)
        .header("content-type", "application/javascript")
        .send('console.error("Fulcrum widget bundle not built — run pnpm --filter @fulcrum/widget build");');
    }
  });

  // Demo host page — stands in for an agent's landing page embedding the tool.
  app.get("/widget/demo", async (req, reply) => {
    const { agent } = req.query as { agent?: string };
    const agentRow = agent
      ? await prisma.agent.findUnique({ where: { id: agent } })
      : await prisma.agent.findFirst({ orderBy: { createdAt: "asc" } });
    const agentId = agentRow?.id ?? "";
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${agentRow?.name ?? "Agent"} — Find your buying power</title>
  <style>
    body { margin:0; font-family: system-ui, sans-serif; background:#eef1f4; color:#0f1a24; }
    .hero { max-width:760px; margin:0 auto; padding:56px 24px 24px; }
    .hero h1 { font-size:30px; letter-spacing:-0.02em; margin:0 0 8px; }
    .hero p { color:#516074; font-size:16px; margin:0 0 28px; max-width:52ch; }
    .agent { display:flex; align-items:center; gap:10px; margin-bottom:26px; font-size:13px; color:#516074; }
    .agent b { color:#0f1a24; }
    footer { max-width:760px; margin:0 auto; padding:16px 24px 60px; color:#8895a6; font-size:12px; }
  </style>
</head>
<body>
  <div class="hero">
    <div class="agent">Presented by <b>${agentRow?.name ?? "your agent"}</b> · demo landing page</div>
    <h1>How much home can you afford?</h1>
    <p>Answer a few questions to see your buying power and get matched with the right homes. Takes 60 seconds.</p>
    <div id="fulcrum-widget"></div>
  </div>
  <footer>This is a demo host page standing in for an agent's website. The tool below is the embeddable Fulcrum buyer widget.</footer>
  <script
    src="/widget/fulcrum-widget.js"
    data-fulcrum-agent="${agentId}"
    data-fulcrum-api=""
  ></script>
</body>
</html>`;
    return reply.header("content-type", "text/html; charset=utf-8").send(html);
  });
}
