import "./env.js";
import Fastify from "fastify";
import { registerLeadRoutes } from "./routes/leads.js";
import { registerPropertyRoutes } from "./routes/properties.js";

const app = Fastify({ logger: true });

app.get("/health", async () => ({ ok: true, service: "fulcrum-api" }));

registerLeadRoutes(app);
registerPropertyRoutes(app);

app
  .listen({ port: Number(process.env.PORT ?? 3011), host: "0.0.0.0" })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
