import type { ErrorRequestHandler } from "express";
import { env } from "../config/env.js";
import { HttpError } from "../lib/http-error.js";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const known = error instanceof HttpError;
  const statusCode = known ? error.statusCode : 500;
  const message = known ? error.message : "An unexpected server error occurred.";

  if (statusCode >= 500) console.error(error);

  res.status(statusCode).json({
    success: false,
    error: {
      code: known ? error.code : "INTERNAL_SERVER_ERROR",
      message,
      ...(env.NODE_ENV !== "production" && error instanceof Error
        ? { debugMessage: error.message }
        : {}),
    },
  });
};
