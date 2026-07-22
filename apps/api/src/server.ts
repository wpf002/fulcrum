import "./env.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerLeadRoutes } from "./routes/leads.js";
import { registerPropertyRoutes } from "./routes/properties.js";
import { registerWidgetRoutes } from "./routes/widget.js";
import { registerMatchRoutes } from "./routes/matches.js";

const app = Fastify({ logger: true });

// The buyer widget is embedded on agents' own domains and posts consented
// leads cross-origin. These endpoints are intentionally public.
await app.register(cors, { origin: true, methods: ["GET", "POST"] });

app.get("/health", async () => ({ ok: true, service: "fulcrum-api" }));

registerLeadRoutes(app);
registerPropertyRoutes(app);
registerWidgetRoutes(app);
registerMatchRoutes(app);

app
  .listen({ port: Number(process.env.PORT ?? 3011), host: "0.0.0.0" })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
