import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const agent = await prisma.agent.upsert({
    where: { email: "demo@fulcrum.dev" },
    update: {},
    create: {
      name: "Demo Agent",
      email: "demo@fulcrum.dev",
      subscriptionTier: "trial",
      territories: { zips: ["78701", "78702", "78703"] },
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
