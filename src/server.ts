import { networkInterfaces } from "node:os";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { connectMongo, disconnectMongo } from "./lib/mongo.js";

function getLanIPv4Addresses(): string[] {
  const addresses: string[] = [];
  for (const interfaces of Object.values(networkInterfaces())) {
    for (const address of interfaces ?? []) {
      if (address.family !== "IPv4" || address.internal) continue;
      const octets = address.address.split(".").map(Number);
      if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) continue;
      const first = octets[0];
      const second = octets[1];
      if (first === undefined || second === undefined) continue;
      const isPrivateIPv4 =
        first === 10 ||
        (first === 192 && second === 168) ||
        (first === 172 && second >= 16 && second <= 31);
      if (isPrivateIPv4) addresses.push(address.address);
    }
  }
  return [...new Set(addresses)];
}

async function start() {
  await connectMongo();

  // Bind to all interfaces so phones on the same Wi-Fi can reach the API.
  const server = app.listen(env.PORT, "0.0.0.0", () => {
    const baseUrl = env.PUBLIC_API_URL ?? `http://localhost:${env.PORT}`;
    console.log(`SM Associate Cars API listening on port ${env.PORT} (${env.NODE_ENV}) — MongoDB connected`);
    console.log(`🚀 API URL: ${baseUrl}`);
    console.log(`🩺 Health check: http://localhost:${env.PORT}/health`);
    for (const address of getLanIPv4Addresses()) {
      console.log(`📱 Phone on same Wi-Fi: http://${address}:${env.PORT}/health`);
    }
    console.log(`📚 Swagger/OpenAPI specification: ${baseUrl}/openapi.yaml`);
    console.log(`📖 Swagger UI: ${baseUrl}/api-docs/`);
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received; closing HTTP server...`);
    server.close((error) => {
      if (error) {
        console.error("Failed to close server cleanly:", error);
        process.exitCode = 1;
      }
      void disconnectMongo();
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch((error: unknown) => {
  console.error("Unable to start API:", error instanceof Error ? error.message : error);
  process.exit(1);
});
