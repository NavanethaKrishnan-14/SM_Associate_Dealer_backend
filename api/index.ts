import type { VercelRequest, VercelResponse } from "@vercel/node";
import { app } from "../src/app.js";
import { connectMongo } from "../src/lib/mongo.js";

let connectionPromise: Promise<void> | undefined;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Reuse the MongoDB connection across warm serverless invocations.
    connectionPromise ??= connectMongo().catch((error) => {
      connectionPromise = undefined;
      throw error;
    });
    await connectionPromise;
    return app(req, res);
  } catch (error) {
    console.error("Vercel API startup failed:", error instanceof Error ? error.message : error);
    return res.status(503).json({
      success: false,
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "The API is temporarily unavailable. Check the server's MongoDB and environment configuration.",
      },
    });
  }
}
