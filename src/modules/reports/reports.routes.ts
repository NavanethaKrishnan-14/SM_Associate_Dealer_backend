import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { HttpError } from "../../lib/http-error.js";
import { Car, CarReport } from "../../lib/mongo.js";

export const reportsRouter = Router();
reportsRouter.use(authenticate, requireRole("CUSTOMER"));

const schema = z.object({
  carId: z.string().regex(/^(?:[A-Z]{3,4}-\d{3,}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i),
  reason: z.string().trim().min(3).max(120),
  details: z.string().trim().max(2000).optional(),
});

reportsRouter.post("/", asyncHandler(async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Choose a valid report reason.", details: parsed.error.flatten().fieldErrors } });
    return;
  }
  const car = await Car.findById(parsed.data.carId).select("_id title").lean();
  if (!car) throw new HttpError(404, "The vehicle listing could not be found.", "CAR_NOT_FOUND");
  const report = await CarReport.create({ carId: String(car._id), reporterId: req.auth!.userId, reason: parsed.data.reason, ...(parsed.data.details ? { details: parsed.data.details } : {}), status: "OPEN" });
  res.status(201).json({ success: true, data: { id: report.id, carId: String(car._id), reason: report.reason, status: report.status, createdAt: report.createdAt }, message: "Your report was submitted for admin review." });
}));
