import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";

export const favoritesRouter = Router();
favoritesRouter.use(authenticate, requireRole(UserRole.CUSTOMER));

favoritesRouter.get("/", asyncHandler(async (req, res) => {
  const items = await prisma.favorite.findMany({
    where: { userId: req.auth!.userId },
    orderBy: { createdAt: "desc" },
    include: {
      car: {
        select: {
          id: true, title: true, variant: true, priceInr: true, manufacturingYear: true,
          mileageKm: true, fuelType: true, transmission: true, city: true, state: true,
          status: true,
          brand: { select: { name: true, slug: true } },
          model: { select: { name: true, slug: true } },
          images: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }], take: 1 },
          dealer: { select: { businessName: true, city: true, verificationStatus: true } },
        },
      },
    },
  });

  res.status(200).json({
    success: true,
    data: items.filter((item) => item.car.status === "AVAILABLE" && item.car.dealer.verificationStatus === "APPROVED"),
  });
}));

favoritesRouter.post("/", asyncHandler(async (req, res) => {
  const parsed = z.object({ carId: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "A valid carId is required." } });
    return;
  }

  const car = await prisma.car.findFirst({
    where: { id: parsed.data.carId, status: "AVAILABLE", publishedAt: { not: null }, dealer: { verificationStatus: "APPROVED" } },
    select: { id: true },
  });
  if (!car) throw new HttpError(404, "This car is not available to save.", "CAR_NOT_FOUND");

  const favorite = await prisma.favorite.upsert({
    where: { userId_carId: { userId: req.auth!.userId, carId: car.id } },
    create: { userId: req.auth!.userId, carId: car.id },
    update: {},
  });
  res.status(201).json({ success: true, data: favorite });
}));

favoritesRouter.delete("/:carId", asyncHandler(async (req, res) => {
  const parsed = z.string().uuid().safeParse(req.params.carId);
  if (!parsed.success) throw new HttpError(400, "The car ID is invalid.", "INVALID_CAR_ID");

  const deleted = await prisma.favorite.deleteMany({
    where: { userId: req.auth!.userId, carId: parsed.data },
  });
  if (deleted.count === 0) throw new HttpError(404, "This car is not in your favourites.", "FAVORITE_NOT_FOUND");

  res.status(200).json({ success: true, data: { carId: parsed.data }, message: "Removed from favourites." });
}));
