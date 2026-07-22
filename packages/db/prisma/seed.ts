import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Same scrypt format as apps/api/src/auth.ts: scrypt$<saltHex>$<hashHex>
function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

async function main() {
  // South/Southwest Austin single-family farming territory
  const territories = { zips: ["78704", "78745", "78748", "78749"] };
  const passwordHash = hashPassword("fulcrum-demo");
  const agent = await prisma.agent.upsert({
    where: { email: "demo@fulcrum.dev" },
    update: { territories, passwordHash },
    create: {
      name: "Demo Agent",
      email: "demo@fulcrum.dev",
      passwordHash,
      subscriptionTier: "trial",
      territories,
      brandConfig: { primaryColor: "#1a56db", logoUrl: null },
    },
  });
  console.log(`seeded agent ${agent.id} (${agent.email}) — login: demo@fulcrum.dev / fulcrum-demo`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
