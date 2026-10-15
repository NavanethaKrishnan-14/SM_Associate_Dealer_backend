import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  API_BASE_PATH: z.string().startsWith("/").default("/api/v1"),
  WEB_ORIGIN: z.string().url().default("https://localhost"),
  // Public origin used to construct links to uploaded images. Never derive production URLs from the Host header.
  PUBLIC_API_URL: z.string().url().default("https://sm-associate-dealer-backend-sand.vercel.app").transform((value) => value.replace(/\/+$/, "")),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  GOOGLE_CLIENT_IDS: z.string().optional().default(""),
  FACEBOOK_APP_ID: z.string().optional().default(""),
  FACEBOOK_APP_SECRET: z.string().optional().default(""),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().min(1).max(90).default(30),
}).superRefine((value, context) => {
  // Public URL settings are optional for auth and health endpoints. Configure
  // PUBLIC_API_URL and WEB_ORIGIN in Vercel for image links and browser CORS.
  if (value.NODE_ENV === "production" && /localhost|127\.0\.0\.1/i.test(value.MONGODB_URI)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["MONGODB_URI"], message: "Production must use a reachable managed MongoDB connection, not localhost." });
  }
  if (value.NODE_ENV === "production" && /replace-this|change-me|your-secret|example-secret/i.test(value.JWT_ACCESS_SECRET)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["JWT_ACCESS_SECRET"], message: "Replace the example JWT secret with a randomly generated production secret." });
  }
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
