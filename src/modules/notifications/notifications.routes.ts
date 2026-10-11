import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import { z } from "zod";

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

notificationsRouter.get("/", asyncHandler(async (req, res) => {
  const parsed = pageSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "INVALID_QUERY", message: "Invalid notification pagination." } });
    return;
  }
  const { page, limit } = parsed.data;
  const where = { userId: req.auth!.userId };
  const [items, total, unread] = await prisma.$transaction([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { ...where, readAt: null } }),
  ]);
  res.status(200).json({
    success: true,
    data: items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    unreadCount: unread,
  });
}));

notificationsRouter.patch("/:id/read", asyncHandler(async (req, res) => {
  const parsed = z.string().uuid().safeParse(req.params.id);
  if (!parsed.success) throw new HttpError(400, "The notification ID is invalid.", "INVALID_NOTIFICATION_ID");

  const result = await prisma.notification.updateMany({
    where: { id: parsed.data, userId: req.auth!.userId, readAt: null },
    data: { readAt: new Date() },
  });
  if (result.count === 0) {
    const exists = await prisma.notification.findFirst({
      where: { id: parsed.data, userId: req.auth!.userId },
      select: { id: true },
    });
    if (!exists) throw new HttpError(404, "Notification not found.", "NOTIFICATION_NOT_FOUND");
  }

  res.status(200).json({ success: true, data: { id: parsed.data, read: true } });
}));

notificationsRouter.patch("/read-all", asyncHandler(async (req, res) => {
  const result = await prisma.notification.updateMany({
    where: { userId: req.auth!.userId, readAt: null },
    data: { readAt: new Date() },
  });
  res.status(200).json({ success: true, data: { updatedCount: result.count } });
}));
