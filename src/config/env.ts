import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  API_BASE_PATH: z.string().startsWith("/").default("/api/v1"),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  // Public origin used to construct links to uploaded images. Never derive production URLs from the Host header.
  PUBLIC_API_URL: z.string().url().optional().transform((value) => value?.replace(/\/+$/, "")),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().min(1).max(90).default(30),
}).superRefine((value, context) => {
  if (value.NODE_ENV === "production" && !value.PUBLIC_API_URL) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["PUBLIC_API_URL"],
      message: "PUBLIC_API_URL is required in production to generate trusted image URLs.",
    });
  }
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
