import { app } from "./app.js";
import { env } from "./config/env.js";
import { connectMongo, disconnectMongo } from "./lib/mongo.js";
async function start() {
 await connectMongo();
 const server = app.listen(env.PORT, () => console.log(`SM Associate Cars API listening on port ${env.PORT} (${env.NODE_ENV}) — MongoDB connected`));
 const shutdown = (signal: string) => {
  console.log(`${signal} received; closing HTTP server...`);
  server.close((error) => { if (error) { console.error("Failed to close server cleanly:", error); process.exitCode = 1; } void disconnectMongo(); });
 };
 process.on("SIGTERM", () => shutdown("SIGTERM"));
 process.on("SIGINT", () => shutdown("SIGINT"));
}
start().catch((error: unknown) => { console.error("Unable to start API:", error instanceof Error ? error.message : error); process.exit(1); });
