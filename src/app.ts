import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { healthRouter } from "./routes/health.routes.js";

export const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin: env.WEB_ORIGIN,
  credentials: true,
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({ success: true, data: { status: "ok" } });
});

app.use(`${env.API_BASE_PATH}/health`, healthRouter);

app.get(env.API_BASE_PATH, (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      name: "SM Associate Cars API",
      version: "v1",
      modules: ["auth", "dealers", "cars", "enquiries", "favorites", "admin"],
    },
  });
});

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: { code: "NOT_FOUND", message: "The requested endpoint was not found." },
  });
});

app.use(errorHandler);
