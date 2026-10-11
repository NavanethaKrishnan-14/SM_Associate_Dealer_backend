import type { RequestHandler } from "express";
import { UserRole } from "@prisma/client";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { env } from "../config/env.js";
import { HttpError } from "../lib/http-error.js";

export const authenticate: RequestHandler = (req, _res, next) => {
  const authorization = req.header("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";

  if (!token) {
    next(new HttpError(401, "Authentication is required.", "UNAUTHENTICATED"));
    return;
  }

  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
    const role = decoded.role;

    if (
      typeof decoded.sub !== "string" ||
      typeof role !== "string" ||
      !Object.values(UserRole).includes(role as UserRole)
    ) {
      next(new HttpError(401, "The access token is invalid.", "INVALID_ACCESS_TOKEN"));
      return;
    }

    req.auth = { userId: decoded.sub, role: role as UserRole };
    next();
  } catch {
    next(new HttpError(401, "The access token is invalid or expired.", "INVALID_ACCESS_TOKEN"));
  }
};

export const requireRole = (...roles: UserRole[]): RequestHandler => (req, _res, next) => {
  if (!req.auth) {
    next(new HttpError(401, "Authentication is required.", "UNAUTHENTICATED"));
    return;
  }

  if (!roles.includes(req.auth.role)) {
    next(new HttpError(403, "You are not allowed to perform this action.", "FORBIDDEN"));
    return;
  }

  next();
};
