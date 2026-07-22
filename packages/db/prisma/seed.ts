import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // South/Southwest Austin single-family farming territory
  const territories = { zips: ["78704", "78745", "78748", "78749"] };
  const agent = await prisma.agent.upsert({
    where: { email: "demo@fulcrum.dev" },
    update: { territories },
    create: {
      name: "Demo Agent",
      email: "demo@fulcrum.dev",
      subscriptionTier: "trial",
      territories,
      brandConfig: { primaryColor: "#1a56db", logoUrl: null },
    },
  });
  console.log(`seeded agent ${agent.id} (${agent.email})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
