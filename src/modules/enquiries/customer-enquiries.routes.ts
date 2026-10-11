import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";

export const customerEnquiriesRouter = Router();
customerEnquiriesRouter.use(authenticate, requireRole(UserRole.CUSTOMER));

const createEnquirySchema = z.object({
  carId: z.string().uuid(),
  message: z.string().trim().min(5).max(3000),
});

customerEnquiriesRouter.post("/", asyncHandler(async (req, res) => {
  const parsed = createEnquirySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Check the enquiry details.", details: parsed.error.flatten().fieldErrors } });
    return;
  }

  const customer = await prisma.user.findUnique({
    where: { id: req.auth!.userId },
    select: { id: true, name: true },
  });
  if (!customer) throw new HttpError(401, "Customer account not found.", "ACCOUNT_NOT_FOUND");

  const car = await prisma.car.findFirst({
    where: { id: parsed.data.carId, status: "AVAILABLE", publishedAt: { not: null }, dealer: { verificationStatus: "APPROVED" } },
    select: {
      id: true, title: true, dealerId: true,
      dealer: { select: { userId: true } },
    },
  });
  if (!car) throw new HttpError(404, "This car is not available for enquiries.", "CAR_NOT_FOUND");

  const enquiry = await prisma.$transaction(async (tx) => {
    const created = await tx.enquiry.create({
      data: {
        carId: car.id,
        customerId: customer.id,
        dealerId: car.dealerId,
        message: parsed.data.message,
      },
      include: {
        car: { select: { id: true, title: true } },
        dealer: { select: { id: true, businessName: true } },
      },
    });

    await tx.notification.create({
      data: {
        userId: car.dealer.userId,
        title: "New car enquiry",
        body: `${customer.name} is interested in ${car.title}.`,
        data: { enquiryId: created.id, carId: car.id },
      },
    });
    return created;
  });

  res.status(201).json({ success: true, data: enquiry, message: "Your enquiry has been sent to the dealer." });
}));

customerEnquiriesRouter.get("/me", asyncHandler(async (req, res) => {
  const items = await prisma.enquiry.findMany({
    where: { customerId: req.auth!.userId },
    orderBy: { createdAt: "desc" },
    include: {
      car: { select: { id: true, title: true, priceInr: true, status: true, brand: { select: { name: true } }, model: { select: { name: true } }, images: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }], take: 1 } } },
      dealer: { select: { id: true, businessName: true, city: true } },
    },
  });
  res.status(200).json({ success: true, data: items });
}));
