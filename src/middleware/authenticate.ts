import type { RequestHandler } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { env } from "../config/env.js";
import { HttpError } from "../lib/http-error.js";
import { User } from "../lib/mongo.js";

export type UserRole = "CUSTOMER" | "DEALER" | "ADMIN" | "SUPER_ADMIN";

export const authenticate: RequestHandler = async (req, _res, next) => {
  const authorization = req.header("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) {
    next(new HttpError(401, "Authentication is required.", "UNAUTHENTICATED"));
    return;
  }

  let decoded: JwtPayload;
  try {
    // Restrict accepted JWT algorithms explicitly; do not rely on library defaults.
    decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ["HS256"] }) as JwtPayload;
  } catch {
    next(new HttpError(401, "The access token is invalid or expired.", "INVALID_ACCESS_TOKEN"));
    return;
  }

  if (
    typeof decoded.sub !== "string" ||
    typeof decoded.role !== "string" ||
    !["CUSTOMER", "DEALER", "ADMIN", "SUPER_ADMIN"].includes(decoded.role)
  ) {
    next(new HttpError(401, "The access token is invalid.", "INVALID_ACCESS_TOKEN"));
    return;
  }

  try {
    // Re-check account status and role so suspended users or changed roles lose access
    // immediately instead of retaining API access until the JWT expires.
    const user = await User.findById(decoded.sub).select("role status").lean();
    if (!user || user.status !== "ACTIVE") {
      next(new HttpError(401, "This account is no longer active. Please sign in again.", "ACCOUNT_INACTIVE"));
      return;
    }
    if (user.role !== decoded.role) {
      next(new HttpError(401, "The account permissions have changed. Please sign in again.", "STALE_ACCESS_TOKEN"));
      return;
    }
    req.auth = { userId: String(user._id), role: user.role as UserRole };
    next();
  } catch (error) {
    next(error);
  }
};

export const requireRole = (...roles: UserRole[]): RequestHandler => (req, _res, next) => {
  if (!req.auth) {
    next(new HttpError(401, "Authentication is required.", "UNAUTHENTICATED"));
    return;
  }
  if (!roles.includes(req.auth.role as UserRole)) {
    next(new HttpError(403, "You are not allowed to perform this action.", "FORBIDDEN"));
    return;
  }
  next();
};
