import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { asyncHandler } from "../../middleware/async-handler.js";
import { Enquiry } from "../../lib/mongo.js";

export const sellCarRouter = Router();

const sellLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, error: { code: "SELL_REQUEST_LIMITED", message: "Too many sell requests. Please try again later." } },
});

const schema = z.object({
  contactName: z.string().trim().min(2).max(100),
  contactPhone: z.string().trim().regex(/^\+?[0-9 ()-]{10,20}$/),
  city: z.string().trim().min(2).max(100),
  brand: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(100),
  year: z.coerce.number().int().min(1950).max(new Date().getFullYear() + 1).optional(),
  kms: z.coerce.number().int().min(0).max(2_000_000).optional(),
  registration: z.string().trim().max(20).optional(),
});

sellCarRouter.post("/", sellLimit, asyncHandler(async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Check the details for your sell-car request.", details: parsed.error.flatten().fieldErrors },
    });
    return;
  }

  const d = parsed.data;
  const vehicleDetails = [
    `Brand: ${d.brand}`,
    `Model: ${d.model}`,
    ...(d.year ? [`Year: ${d.year}`] : []),
    ...(d.kms !== undefined ? [`Kilometres: ${d.kms}`] : []),
    ...(d.registration ? [`Registration: ${d.registration}`] : []),
    `Seller city: ${d.city}`,
    `Contact: ${d.contactName}, ${d.contactPhone}`,
  ].join("\n");

  // Sell requests are stored as a lead in the existing Enquiry collection. carId and
  // dealerId are intentionally absent; this is an intake lead, not an enquiry on a listed car.
  const lead = await Enquiry.create({
    contactName: d.contactName,
    contactPhone: d.contactPhone,
    message: `SELL-CAR REQUEST\n${vehicleDetails}`,
    status: "OPEN",
    enquiryType: "SELL_CAR",
  });

  res.status(201).json({
    success: true,
    data: { id: lead.id, status: lead.status, createdAt: lead.createdAt },
    message: "Your sell-car request has been received.",
  });
}));
