import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";

export const dealerTestDrivesRouter = Router();
dealerTestDrivesRouter.use(authenticate, requireRole(UserRole.DEALER));

const querySchema = z.object({
  status: z.enum(["REQUESTED", "CONFIRMED", "COMPLETED", "CANCELLED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const decisionSchema = z.object({ status: z.enum(["CONFIRMED", "COMPLETED", "CANCELLED"]) });

async function getDealer(userId: string) {
  const dealer = await prisma.dealer.findUnique({ where: { userId }, select: { id: true } });
  if (!dealer) throw new HttpError(403, "A dealer profile is required.", "DEALER_PROFILE_REQUIRED");
  return dealer;
}

dealerTestDrivesRouter.get("/", asyncHandler(async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid test-drive filters.", details: parsed.error.flatten().fieldErrors } });
    return;
  }
  const dealer = await getDealer(req.auth!.userId);
  const { page, limit, status } = parsed.data;
  const where = { dealerId: dealer.id, ...(status ? { status } : {}) };
  const [items, total] = await prisma.$transaction([
    prisma.testDrive.findMany({
      where,
      orderBy: { scheduledAt: "asc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        car: { select: { id: true, title: true, priceInr: true, images: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }], take: 1 } } },
        customer: { select: { id: true, name: true, phone: true, email: true } },
      },
    }),
    prisma.testDrive.count({ where }),
  ]);
  res.status(200).json({ success: true, data: items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

dealerTestDrivesRouter.patch("/:id", asyncHandler(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const parsed = decisionSchema.safeParse(req.body);
  if (!id.success || !parsed.success) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Enter a valid test-drive ID and status." } });
    return;
  }

  const dealer = await getDealer(req.auth!.userId);
  const booking = await prisma.testDrive.findFirst({
    where: { id: id.data, dealerId: dealer.id },
    include: { car: { select: { title: true } } },
  });
  if (!booking) throw new HttpError(404, "Test-drive request not found.", "TEST_DRIVE_NOT_FOUND");
  const allowed =
    (booking.status === "REQUESTED" && (parsed.data.status === "CONFIRMED" || parsed.data.status === "CANCELLED")) ||
    (booking.status === "CONFIRMED" && (parsed.data.status === "COMPLETED" || parsed.data.status === "CANCELLED"));
  if (!allowed) throw new HttpError(409, "This test-drive status transition is not allowed.", "INVALID_STATUS_TRANSITION");

  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.testDrive.update({ where: { id: booking.id }, data: { status: parsed.data.status } });
    await tx.notification.create({
      data: {
        userId: booking.customerId,
        title: "Test-drive update",
        body: `Your test-drive request for ${booking.car.title} is now ${parsed.data.status.toLowerCase()}.`,
        data: { testDriveId: booking.id, status: parsed.data.status },
      },
    });
    return item;
  });
  res.status(200).json({ success: true, data: updated });
}));
