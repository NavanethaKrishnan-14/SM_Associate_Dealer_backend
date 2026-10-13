import type { Request, Response } from "express";
import { app } from "../src/app.js";
import { connectMongo } from "../src/lib/mongo.js";

let connectionPromise: Promise<void> | undefined;

export default async function handler(req: Request, res: Response) {
  try {
    // Vercel rewrites public API URLs to this function. Prefer the parsed
    // query value (Vercel's normalized request) and fall back to the raw URL.
    const queryPath = req.query.originalPath;
    const rawUrl = new URL(req.url ?? "/", "https://vercel.internal");
    const rawPath = rawUrl.searchParams.get("originalPath");
    const originalPath = (typeof queryPath === "string" ? queryPath : rawPath) ?? "/";
    const queryIndex = originalPath.indexOf("?");
    const pathOnly = queryIndex >= 0 ? originalPath.slice(0, queryIndex) : originalPath;
    const originalQuery = queryIndex >= 0 ? originalPath.slice(queryIndex + 1) : "";

    // Preserve any actual query parameters forwarded by Vercel, but remove
    // the internal rewrite parameter so it never leaks into application routes.
    const extraQuery = new URLSearchParams(originalQuery);
    for (const [key, value] of Object.entries(req.query)) {
      if (key === "originalPath") continue;
      if (Array.isArray(value)) {
        for (const item of value) if (typeof item === "string") extraQuery.append(key, item);
      } else if (typeof value === "string") {
        extraQuery.append(key, value);
      }
    }
    req.url = pathOnly + (extraQuery.size ? `?${extraQuery.toString()}` : "");

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
