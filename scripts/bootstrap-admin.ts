import "dotenv/config";
import { connectMongo, disconnectMongo, User } from "../src/lib/mongo.js";
async function main() {
 await connectMongo();
 const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
 if (!email) throw new Error("Set ADMIN_BOOTSTRAP_EMAIL to the email of an existing account before running this command.");
 if (await User.countDocuments({ role: "SUPER_ADMIN", status: "ACTIVE" }) > 0) throw new Error("An active super administrator already exists. Refusing to create another through bootstrap.");
 const target = await User.findOne({ email }).select("name email role status");
 if (!target) throw new Error("No account uses ADMIN_BOOTSTRAP_EMAIL. Register that account through the app first, then run bootstrap.");
 target.role = "SUPER_ADMIN"; target.status = "ACTIVE"; await target.save();
 console.log("Super administrator configured:", { id: target.id, name: target.name, email: target.email, role: target.role });
 console.log("Remove ADMIN_BOOTSTRAP_EMAIL from your shell after this one-time command.");
}
main().catch((error: unknown) => { console.error("Admin bootstrap failed:", error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(async () => { await disconnectMongo(); });
