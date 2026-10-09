import { prisma } from "./src/lib/prisma.js";

async function main() {
  const stale = await prisma.job.findMany({
    where: { status: { in: ["PENDING", "RUNNING"] } },
    select: { id: true, type: true, organizationId: true, status: true },
  });
  console.log("PENDING/RUNNING:", JSON.stringify(stale));
  if (stale.length > 0) {
    const orgId = stale[0].organizationId;
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true },
    });
    const user = await prisma.user.findFirst({
      where: { organizationId: orgId },
      select: { email: true },
    });
    console.log("org:", JSON.stringify(org), "user:", user?.email);
  }
  await prisma.$disconnect();
}

main();