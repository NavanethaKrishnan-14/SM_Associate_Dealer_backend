import { Router } from "express";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: "ok",
      service: "sm-associate-cars-api",
      timestamp: new Date().toISOString(),
    },
  });
});
