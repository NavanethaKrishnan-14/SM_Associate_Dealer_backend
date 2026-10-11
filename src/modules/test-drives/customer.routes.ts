import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";

export const customerTestDrivesRouter = Router();
customerTestDrivesRouter.use(authenticate, requireRole(UserRole.CUSTOMER));

const bookingSchema = z.object({
  carId: z.string().uuid(),
  scheduledAt: z.coerce.date(),
  notes: z.string().trim().max(1000).optional(),
}).refine((value) => value.scheduledAt.getTime() > Date.now(), {
  message: "Choose a future date and time.",
  path: ["scheduledAt"],
}).refine((value) => value.scheduledAt.getTime() <= Date.now() + 90 * 24 * 60 * 60 * 1000, {
  message: "Bookings can be made up to 90 days in advance.",
  path: ["scheduledAt"],
});

customerTestDrivesRouter.post("/", asyncHandler(async (req, res) => {
  const parsed = bookingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Check the test-drive date and details.", details: parsed.error.flatten().fieldErrors } });
    return;
  }

  const customerId = req.auth!.userId;
  const car = await prisma.car.findFirst({
    where: { id: parsed.data.carId, status: "AVAILABLE", publishedAt: { not: null }, dealer: { verificationStatus: "APPROVED" } },
    select: { id: true, title: true, dealerId: true, dealer: { select: { userId: true } } },
  });
  if (!car) throw new HttpError(404, "This car is not available for a test drive.", "CAR_NOT_FOUND");

  const booking = await prisma.$transaction(async (tx) => {
    const conflict = await tx.testDrive.findFirst({
      where: {
        dealerId: car.dealerId,
        scheduledAt: parsed.data.scheduledAt,
        status: { in: ["REQUESTED", "CONFIRMED"] },
      },
      select: { id: true },
    });
    if (conflict) throw new HttpError(409, "This dealer already has a request for that time. Choose another slot.", "TIME_SLOT_UNAVAILABLE");

    const created = await tx.testDrive.create({
      data: {
        carId: car.id,
        customerId,
        dealerId: car.dealerId,
        scheduledAt: parsed.data.scheduledAt,
        ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
      },
      include: { car: { select: { id: true, title: true } }, dealer: { select: { id: true, businessName: true } } },
    });
    await tx.notification.create({
      data: {
        userId: car.dealer.userId,
        title: "New test-drive request",
        body: `A customer requested a test drive for ${car.title}.`,
        data: { testDriveId: created.id, carId: car.id },
      },
    });
    return created;
  });

  res.status(201).json({ success: true, data: booking, message: "Your test-drive request was sent to the dealer." });
}));

customerTestDrivesRouter.get("/me", asyncHandler(async (req, res) => {
  const items = await prisma.testDrive.findMany({
    where: { customerId: req.auth!.userId },
    orderBy: { scheduledAt: "desc" },
    include: {
      car: { select: { id: true, title: true, priceInr: true, status: true, images: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }], take: 1 } } },
      dealer: { select: { id: true, businessName: true, city: true } },
    },
  });
  res.status(200).json({ success: true, data: items });
}));

customerTestDrivesRouter.patch("/me/:id/cancel", asyncHandler(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) throw new HttpError(400, "The test-drive ID is invalid.", "INVALID_TEST_DRIVE_ID");

  const booking = await prisma.testDrive.findFirst({ where: { id: id.data, customerId: req.auth!.userId } });
  if (!booking) throw new HttpError(404, "Test-drive request not found.", "TEST_DRIVE_NOT_FOUND");
  if (booking.status !== "REQUESTED" && booking.status !== "CONFIRMED") {
    throw new HttpError(409, "This test-drive request can no longer be cancelled.", "TEST_DRIVE_NOT_CANCELLABLE");
  }

  const updated = await prisma.testDrive.update({ where: { id: booking.id }, data: { status: "CANCELLED" } });
  const dealer = await prisma.dealer.findUnique({ where: { id: booking.dealerId }, select: { userId: true } });
  if (dealer) {
    await prisma.notification.create({
      data: {
        userId: dealer.userId,
        title: "Test drive cancelled",
        body: "A customer cancelled a test-drive request.",
        data: { testDriveId: booking.id, carId: booking.carId },
      },
    });
  }
  res.status(200).json({ success: true, data: updated });
}));
