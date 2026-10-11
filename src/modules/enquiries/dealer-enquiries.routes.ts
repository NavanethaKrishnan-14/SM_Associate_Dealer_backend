import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";

export const dealerEnquiriesRouter = Router();
dealerEnquiriesRouter.use(authenticate, requireRole(UserRole.DEALER));

const querySchema = z.object({
  status: z.enum(["NEW", "CONTACTED", "IN_PROGRESS", "CLOSED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const updateSchema = z.object({ status: z.enum(["NEW", "CONTACTED", "IN_PROGRESS", "CLOSED"]) });

async function getDealerId(userId: string) {
  const dealer = await prisma.dealer.findUnique({ where: { userId }, select: { id: true } });
  if (!dealer) throw new HttpError(403, "A dealer profile is required.", "DEALER_PROFILE_REQUIRED");
  return dealer.id;
}

dealerEnquiriesRouter.get("/", asyncHandler(async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid enquiry filters.", details: parsed.error.flatten().fieldErrors } });
    return;
  }
  const dealerId = await getDealerId(req.auth!.userId);
  const { page, limit, status } = parsed.data;
  const where = { dealerId, ...(status ? { status } : {}) };
  const [items, total] = await prisma.$transaction([
    prisma.enquiry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        car: { select: { id: true, title: true, priceInr: true, status: true, images: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }], take: 1 } } },
        customer: { select: { id: true, name: true, phone: true, email: true } },
      },
    }),
    prisma.enquiry.count({ where }),
  ]);
  res.status(200).json({ success: true, data: items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

dealerEnquiriesRouter.patch("/:id", asyncHandler(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const parsed = updateSchema.safeParse(req.body);
  if (!id.success || !parsed.success) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Enter a valid enquiry ID and status." } });
    return;
  }
  const dealerId = await getDealerId(req.auth!.userId);
  const existing = await prisma.enquiry.findFirst({ where: { id: id.data, dealerId } });
  if (!existing) throw new HttpError(404, "Enquiry not found in your inbox.", "ENQUIRY_NOT_FOUND");

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.enquiry.update({
      where: { id: existing.id },
      data: {
        status: parsed.data.status,
        ...(parsed.data.status === "CONTACTED" && !existing.contactedAt ? { contactedAt: now } : {}),
        ...(parsed.data.status === "CLOSED" ? { closedAt: now } : {}),
      },
    });
    await tx.notification.create({
      data: {
        userId: existing.customerId,
        title: "Enquiry update",
        body: `The dealer updated your enquiry status to ${parsed.data.status.toLowerCase().replace("_", " ")}.`,
        data: { enquiryId: existing.id, status: parsed.data.status },
      },
    });
    return item;
  });
  res.status(200).json({ success: true, data: updated });
}));
