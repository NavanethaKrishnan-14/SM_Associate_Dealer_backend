import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";

export const customerProfileRouter = Router();
customerProfileRouter.use(authenticate, requireRole(UserRole.CUSTOMER));

const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().regex(/^\+?[0-9]{10,15}$/).optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
}).refine((data) => Object.values(data).some((value) => value !== undefined), {
  message: "Provide at least one profile field to update.",
});

customerProfileRouter.patch("/me", asyncHandler(async (req, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Check your profile fields.", details: parsed.error.flatten().fieldErrors } });
    return;
  }

  const data = parsed.data;
  try {
    const user = await prisma.user.update({
      where: { id: req.auth!.userId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.email !== undefined ? { email: data.email?.toLowerCase() ?? null } : {}),
      },
      select: { id: true, name: true, email: true, phone: true, role: true, status: true, createdAt: true, updatedAt: true },
    });
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    if (
      typeof error === "object" && error !== null &&
      "code" in error && (error as { code?: unknown }).code === "P2002"
    ) {
      throw new HttpError(409, "That phone number or email is already in use.", "PROFILE_VALUE_ALREADY_EXISTS");
    }
    throw error;
  }
}));
