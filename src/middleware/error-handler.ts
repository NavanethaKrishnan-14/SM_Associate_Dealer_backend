import type { ErrorRequestHandler } from "express";
import { MulterError } from "multer";
import { env } from "../config/env.js";
import { HttpError } from "../lib/http-error.js";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const known = error instanceof HttpError;
  const uploadError = error instanceof MulterError;
  const uploadTooLarge = uploadError && error.code === "LIMIT_FILE_SIZE";
  const statusCode = known ? error.statusCode : uploadError ? (uploadTooLarge ? 413 : 400) : 500;
  const message = known ? error.message
    : uploadTooLarge ? "Each photo must be 10 MB or smaller."
    : uploadError ? "The photo upload request is invalid."
    : "An unexpected server error occurred.";

  if (statusCode >= 500) console.error(error);

  res.status(statusCode).json({
    success: false,
    error: {
      code: known ? error.code : uploadError ? (uploadTooLarge ? "IMAGE_TOO_LARGE" : "INVALID_IMAGE_UPLOAD") : "INTERNAL_SERVER_ERROR",
      message,
      ...(env.NODE_ENV !== "production" && error instanceof Error
        ? { debugMessage: error.message }
        : {}),
    },
  });
};
