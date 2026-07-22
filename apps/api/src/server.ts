import "./env.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerAuth } from "./auth.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerLeadRoutes } from "./routes/leads.js";
import { registerPropertyRoutes } from "./routes/properties.js";
import { registerWidgetRoutes } from "./routes/widget.js";
import { registerMatchRoutes } from "./routes/matches.js";
import { registerOutcomeRoutes } from "./routes/outcomes.js";

const app = Fastify({ logger: true });

// The buyer widget is embedded on agents' own domains and posts consented
// leads cross-origin. These endpoints are intentionally public.
await app.register(cors, { origin: true, methods: ["GET", "POST"] });

// JWT + the `authenticate` preHandler (agent auth / multi-tenancy).
await registerAuth(app);

app.get("/health", async () => ({ ok: true, service: "fulcrum-api" }));

registerAuthRoutes(app);
registerLeadRoutes(app);
registerPropertyRoutes(app);
registerWidgetRoutes(app);
registerMatchRoutes(app);
registerOutcomeRoutes(app);

app
  .listen({ port: Number(process.env.PORT ?? 3011), host: "0.0.0.0" })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });

export { app };
