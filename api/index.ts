import type { Request, Response } from "express";
import { app } from "../src/app.js";
import { connectMongo } from "../src/lib/mongo.js";

let connectionPromise: Promise<void> | undefined;

export default async function handler(req: Request, res: Response) {
  try {
    // Vercel's rewrite forwards every public path to this function. Restore
    // the original path before passing the request to Express.
    const originalPath = typeof req.query.originalPath === "string"
      ? req.query.originalPath
      : "/";
    const queryIndex = originalPath.indexOf("?");
    const pathOnly = queryIndex >= 0 ? originalPath.slice(0, queryIndex) : originalPath;
    const originalQuery = queryIndex >= 0 ? originalPath.slice(queryIndex + 1) : "";
    const forwardedQuery = { ...req.query };
    delete forwardedQuery.originalPath;
    const extraQuery = new URLSearchParams();
    for (const [key, value] of Object.entries(forwardedQuery)) {
      if (Array.isArray(value)) value.forEach((item) => extraQuery.append(key, item));
      else if (typeof value === "string") extraQuery.append(key, value);
    }
    const queryString = [originalQuery, extraQuery.toString()].filter(Boolean).join("&");
    req.url = pathOnly + (queryString ? `?${queryString}` : "");

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
