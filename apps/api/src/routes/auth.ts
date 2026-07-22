import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@fulcrum/db";
import { hashPassword, verifyPassword } from "../auth.js";

const signupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, "password must be at least 8 characters"),
  territories: z.object({ zips: z.array(z.string()) }).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function tokenFor(app: FastifyInstance, agentId: string): string {
  // 7-day sessions for this dev app
  return app.jwt.sign({ agentId }, { expiresIn: "7d" });
}

export function registerAuthRoutes(app: FastifyInstance) {
  app.post("/v1/auth/signup", async (req, reply) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { name, email, password, territories } = parsed.data;

    const existing = await prisma.agent.findUnique({ where: { email } });
    if (existing) return reply.code(409).send({ error: "email already registered" });

    const agent = await prisma.agent.create({
      data: {
        name,
        email,
        passwordHash: await hashPassword(password),
        territories: territories ?? { zips: [] },
        brandConfig: { primaryColor: "#1f5a46", logoUrl: null },
      },
    });
    return reply.code(201).send({ token: tokenFor(app, agent.id), agent: { id: agent.id, name, email } });
  });

  app.post("/v1/auth/login", async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { email, password } = parsed.data;

    const agent = await prisma.agent.findUnique({ where: { email } });
    // constant-ish work whether or not the agent exists (avoid user enumeration)
    const ok = await verifyPassword(password, agent?.passwordHash ?? null);
    if (!agent || !ok) return reply.code(401).send({ error: "invalid email or password" });

    return reply.send({ token: tokenFor(app, agent.id), agent: { id: agent.id, name: agent.name, email } });
  });

  // Current authenticated agent.
  app.get("/v1/me", { preHandler: [app.authenticate] }, async (req, reply) => {
    const agent = await prisma.agent.findUnique({
      where: { id: req.agentId },
      select: { id: true, name: true, email: true, territories: true, subscriptionTier: true },
    });
    if (!agent) return reply.code(404).send({ error: "agent not found" });
    return reply.send(agent);
  });
}
