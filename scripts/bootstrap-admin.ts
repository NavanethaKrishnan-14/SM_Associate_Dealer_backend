import "dotenv/config";
import bcrypt from "bcryptjs";
import { connectMongo, disconnectMongo, User } from "../src/lib/mongo.js";

async function main() {
  await connectMongo();
  // Convert legacy records to the one supported privileged role.
  await User.updateMany({ role: "SUPER_ADMIN" }, { $set: { role: "ADMIN" } });

  const name = process.env.ADMIN_NAME?.trim();
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const phone = process.env.ADMIN_PHONE?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!name || !email || !phone || !password) {
    throw new Error("Set ADMIN_NAME, ADMIN_EMAIL, ADMIN_PHONE, and ADMIN_PASSWORD before running npm run admin:seed.");
  }
  if (password.length < 12 || password.length > 72) throw new Error("ADMIN_PASSWORD must be between 12 and 72 characters.");
  if (!/^\\+?[0-9]{10,15}$/.test(phone)) throw new Error("ADMIN_PHONE must contain 10 to 15 digits, optionally prefixed with +.");
  if (await User.countDocuments({ role: "ADMIN" }) > 0) {
    throw new Error("An ADMIN account already exists. Sign in as that account to add more admins from the mobile Admin dashboard.");
  }
  const conflict = await User.findOne({ $or: [{ email }, { phone }] }).select("_id email phone");
  if (conflict) throw new Error("The supplied admin email or phone already belongs to another account. Choose unused contact details.");
  const user = await User.create({ name, email, phone, passwordHash: await bcrypt.hash(password, 12), role: "ADMIN", status: "ACTIVE" });
  console.log("Initial ADMIN account created:", { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role });
  console.log("Remove ADMIN_PASSWORD from your shell/environment after seeding. Never commit secrets.");
}

main().catch((error: unknown) => { console.error("Admin seed failed:", error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(async () => { await disconnectMongo(); });
