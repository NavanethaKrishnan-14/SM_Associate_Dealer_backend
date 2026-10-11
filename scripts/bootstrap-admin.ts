import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

async function main() {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  if (!email) {
    throw new Error("Set ADMIN_BOOTSTRAP_EMAIL to the email of an existing account before running this command.");
  }

  const existingSuperAdmins = await prisma.user.count({
    where: { role: "SUPER_ADMIN", status: "ACTIVE" },
  });

  if (existingSuperAdmins > 0) {
    throw new Error("An active super administrator already exists. Refusing to create another through bootstrap.");
  }

  const target = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, role: true, status: true },
  });

  if (!target) {
    throw new Error("No account uses ADMIN_BOOTSTRAP_EMAIL. Register that account through the app first, then run bootstrap.");
  }

  const promoted = await prisma.user.update({
    where: { id: target.id },
    data: { role: "SUPER_ADMIN", status: "ACTIVE" },
    select: { id: true, name: true, email: true, role: true, status: true },
  });

  console.log("Super administrator configured:", {
    id: promoted.id,
    name: promoted.name,
    email: promoted.email,
    role: promoted.role,
  });
  console.log("Remove ADMIN_BOOTSTRAP_EMAIL from your shell after this one-time command.");
}

main()
  .catch((error: unknown) => {
    console.error("Admin bootstrap failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
