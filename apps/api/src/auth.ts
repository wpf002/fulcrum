import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";

const scrypt = promisify(_scrypt);

// ── password hashing (scrypt, built-in — no native dep) ──
// stored form: scrypt$<saltHex>$<hashHex>
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { agentId: string };
    user: { agentId: string };
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    agentId: string;
  }
}

/** Registers JWT + an `authenticate` preHandler that sets req.agentId. */
export async function registerAuth(app: FastifyInstance) {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("JWT_SECRET must be set (>=16 chars) to run the API with auth");
  }
  await app.register(fastifyJwt, { secret });

  app.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { agentId } = await req.jwtVerify<{ agentId: string }>();
      req.agentId = agentId;
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });
}
