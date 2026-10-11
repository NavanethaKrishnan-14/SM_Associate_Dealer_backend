import { Router } from "express";
import { Prisma, UserRole } from "@prisma/client";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";

export const adminRouter = Router();
adminRouter.use(authenticate, requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN));

const idSchema = z.string().uuid();
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const dealerListSchema = pageSchema.extend({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "SUSPENDED"]).optional(),
});
const userListSchema = pageSchema.extend({
  role: z.enum(["CUSTOMER", "DEALER", "ADMIN", "SUPER_ADMIN"]).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "PENDING_VERIFICATION"]).optional(),
});
const dealerDecisionSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED", "SUSPENDED"]),
  reason: z.string().trim().max(1000).optional(),
});
const moderationSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().trim().max(1000).optional(),
});
const accountStatusSchema = z.object({ status: z.enum(["ACTIVE", "SUSPENDED", "PENDING_VERIFICATION"]) });
const reportStatusSchema = z.object({ status: z.enum(["UNDER_REVIEW", "RESOLVED", "DISMISSED"]) });

function parseId(value: string) {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, "The ID is invalid.", "INVALID_ID");
  return parsed.data;
}

function queryError(res: Parameters<Parameters<typeof asyncHandler>[0]>[1], message: string, details: unknown) {
  res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message, details } });
}

async function recordAudit(
  tx: Prisma.TransactionClient,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  details?: Prisma.InputJsonValue,
) {
  await tx.auditLog.create({
    data: { actorId, action, entityType, entityId, ...(details !== undefined ? { details } : {}) },
  });
}

adminRouter.get("/dashboard", asyncHandler(async (_req, res) => {
  const [users, dealersPending, carsPending, carsAvailable, newEnquiries, testDrivesPending] = await prisma.$transaction([
    prisma.user.count(),
    prisma.dealer.count({ where: { verificationStatus: "PENDING" } }),
    prisma.car.count({ where: { status: "PENDING_APPROVAL" } }),
    prisma.car.count({ where: { status: "AVAILABLE", dealer: { verificationStatus: "APPROVED" } } }),
    prisma.enquiry.count({ where: { status: "NEW" } }),
    prisma.testDrive.count({ where: { status: "REQUESTED" } }),
  ]);
  res.status(200).json({
    success: true,
    data: { users, dealersPending, carsPending, carsAvailable, newEnquiries, testDrivesPending },
  });
}));

adminRouter.get("/dealers", asyncHandler(async (req, res) => {
  const parsed = dealerListSchema.safeParse(req.query);
  if (!parsed.success) {
    queryError(res, "Invalid dealer filters.", parsed.error.flatten().fieldErrors);
    return;
  }
  const { page, limit, status } = parsed.data;
  const where: Prisma.DealerWhereInput = status ? { verificationStatus: status } : {};
  const [items, total] = await prisma.$transaction([
    prisma.dealer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: { user: { select: { id: true, name: true, email: true, phone: true, status: true } } },
    }),
    prisma.dealer.count({ where }),
  ]);
  res.status(200).json({ success: true, data: items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

adminRouter.patch("/dealers/:id/verification", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const parsed = dealerDecisionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Choose a valid verification status.", details: parsed.error.flatten().fieldErrors } });
    return;
  }
  const actorId = req.auth!.userId;
  const existing = await prisma.dealer.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Dealer not found.", "DEALER_NOT_FOUND");

  const dealer = await prisma.$transaction(async (tx) => {
    const updated = await tx.dealer.update({
      where: { id },
      data: {
        verificationStatus: parsed.data.status,
        verifiedAt: parsed.data.status === "APPROVED" ? new Date() : null,
      },
      include: { user: { select: { id: true, name: true, email: true, phone: true, status: true } } },
    });
    await recordAudit(tx, actorId, "DEALER_VERIFICATION_UPDATED", "Dealer", id, {
      status: parsed.data.status,
      reason: parsed.data.reason ?? null,
    });
    return updated;
  });
  res.status(200).json({ success: true, data: dealer });
}));

adminRouter.get("/cars/pending", asyncHandler(async (req, res) => {
  const parsed = pageSchema.safeParse(req.query);
  if (!parsed.success) {
    queryError(res, "Invalid pagination.", parsed.error.flatten().fieldErrors);
    return;
  }
  const { page, limit } = parsed.data;
  const where: Prisma.CarWhereInput = { status: "PENDING_APPROVAL" };
  const [items, total] = await prisma.$transaction([
    prisma.car.findMany({
      where,
      orderBy: { updatedAt: "asc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        brand: { select: { name: true } },
        model: { select: { name: true } },
        dealer: { include: { user: { select: { name: true, email: true, phone: true } } } },
        images: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }] },
      },
    }),
    prisma.car.count({ where }),
  ]);
  res.status(200).json({ success: true, data: items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

adminRouter.patch("/cars/:id/moderation", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const parsed = moderationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Choose APPROVE or REJECT.", details: parsed.error.flatten().fieldErrors } });
    return;
  }

  const existing = await prisma.car.findUnique({ where: { id }, include: { dealer: true } });
  if (!existing) throw new HttpError(404, "Vehicle not found.", "CAR_NOT_FOUND");
  if (existing.status !== "PENDING_APPROVAL") {
    throw new HttpError(409, "Only listings awaiting review can be moderated.", "CAR_NOT_PENDING");
  }
  if (parsed.data.decision === "APPROVE" && existing.dealer.verificationStatus !== "APPROVED") {
    throw new HttpError(409, "Approve the dealer before approving this listing.", "DEALER_NOT_APPROVED");
  }

  const actorId = req.auth!.userId;
  const status = parsed.data.decision === "APPROVE" ? "AVAILABLE" : "REJECTED";
  const updated = await prisma.$transaction(async (tx) => {
    const car = await tx.car.update({
      where: { id },
      data: {
        status,
        publishedAt: status === "AVAILABLE" ? new Date() : null,
        moderationNote: parsed.data.reason ?? null,
      },
    });
    await recordAudit(tx, actorId, "CAR_MODERATION_DECIDED", "Car", id, {
      decision: parsed.data.decision,
      status,
      reason: parsed.data.reason ?? null,
    });
    return car;
  });
  res.status(200).json({ success: true, data: updated });
}));

adminRouter.get("/users", asyncHandler(async (req, res) => {
  const parsed = userListSchema.safeParse(req.query);
  if (!parsed.success) {
    queryError(res, "Invalid user filters.", parsed.error.flatten().fieldErrors);
    return;
  }
  const { page, limit, role, status } = parsed.data;
  const where: Prisma.UserWhereInput = {
    ...(role ? { role } : {}),
    ...(status ? { status } : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: { id: true, name: true, email: true, phone: true, role: true, status: true, createdAt: true, dealerProfile: { select: { id: true, businessName: true, verificationStatus: true } } },
    }),
    prisma.user.count({ where }),
  ]);
  res.status(200).json({ success: true, data: items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

adminRouter.patch("/users/:id/status", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const parsed = accountStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Choose a valid account status.", details: parsed.error.flatten().fieldErrors } });
    return;
  }
  const actor = req.auth!;
  if (actor.userId === id) throw new HttpError(409, "You cannot change your own account status.", "SELF_STATUS_CHANGE_BLOCKED");

  const existing = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
  if (!existing) throw new HttpError(404, "User not found.", "USER_NOT_FOUND");
  if ((existing.role === "ADMIN" || existing.role === "SUPER_ADMIN") && actor.role !== "SUPER_ADMIN") {
    throw new HttpError(403, "Only a super administrator can manage administrator accounts.", "ADMIN_MANAGEMENT_FORBIDDEN");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id },
      data: { status: parsed.data.status },
      select: { id: true, name: true, email: true, phone: true, role: true, status: true },
    });
    await recordAudit(tx, actor.userId, "USER_STATUS_UPDATED", "User", id, { status: parsed.data.status });
    return user;
  });
  res.status(200).json({ success: true, data: updated });
}));

adminRouter.get("/reports", asyncHandler(async (req, res) => {
  const parsed = pageSchema.safeParse(req.query);
  if (!parsed.success) {
    queryError(res, "Invalid pagination.", parsed.error.flatten().fieldErrors);
    return;
  }
  const { page, limit } = parsed.data;
  const [items, total] = await prisma.$transaction([
    prisma.carReport.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        car: { select: { id: true, title: true, status: true, city: true } },
        reporter: { select: { id: true, name: true, email: true, phone: true } },
      },
    }),
    prisma.carReport.count(),
  ]);
  res.status(200).json({ success: true, data: items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

adminRouter.patch("/reports/:id/status", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const parsed = reportStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Choose a valid report status.", details: parsed.error.flatten().fieldErrors } });
    return;
  }
  const report = await prisma.carReport.findUnique({ where: { id } });
  if (!report) throw new HttpError(404, "Report not found.", "REPORT_NOT_FOUND");
  const actorId = req.auth!.userId;
  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.carReport.update({
      where: { id },
      data: { status: parsed.data.status, resolvedAt: parsed.data.status === "RESOLVED" || parsed.data.status === "DISMISSED" ? new Date() : null },
    });
    await recordAudit(tx, actorId, "CAR_REPORT_UPDATED", "CarReport", id, { status: parsed.data.status });
    return item;
  });
  res.status(200).json({ success: true, data: updated });
}));

adminRouter.get("/audit-logs", asyncHandler(async (req, res) => {
  const parsed = pageSchema.safeParse(req.query);
  if (!parsed.success) {
    queryError(res, "Invalid pagination.", parsed.error.flatten().fieldErrors);
    return;
  }
  const { page, limit } = parsed.data;
  const [items, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: { actor: { select: { id: true, name: true, role: true } } },
    }),
    prisma.auditLog.count(),
  ]);
  res.status(200).json({ success: true, data: items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));
