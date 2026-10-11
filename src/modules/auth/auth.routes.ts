import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import { UserRole, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../../config/env.js";
import { authenticate } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";

export const authRouter = Router();

const passwordSchema = z.string().min(8).max(72);
const phoneSchema = z.string().trim().regex(/^\+?[0-9]{10,15}$/, "Enter a valid phone number.");
const emailSchema = z.string().trim().email().max(254).optional();

const customerRegistrationSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: phoneSchema,
  email: emailSchema,
  password: passwordSchema,
});

const dealerRegistrationSchema = customerRegistrationSchema.extend({
  businessName: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(100),
});

const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(254),
  password: passwordSchema,
});

const refreshSchema = z.object({ refreshToken: z.string().min(20).max(256) });

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

async function issueSession(user: { id: string; role: UserRole }) {
  const refreshToken = randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: hashToken(refreshToken), expiresAt },
  });

  const accessToken = jwt.sign(
    { role: user.role },
    env.JWT_ACCESS_SECRET,
    { subject: user.id, expiresIn: env.JWT_ACCESS_TTL_SECONDS },
  );

  return {
    accessToken,
    refreshToken,
    tokenType: "Bearer",
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
  };
}

function duplicateAccountError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

authRouter.post("/register/customer", asyncHandler(async (req, res) => {
  const parsed = customerRegistrationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Check the registration details.", details: parsed.error.flatten().fieldErrors },
    });
    return;
  }

  const data = parsed.data;
  try {
    const user = await prisma.user.create({
      data: {
        name: data.name,
        phone: data.phone,
        ...(data.email ? { email: data.email.toLowerCase() } : {}),
        passwordHash: await bcrypt.hash(data.password, 12),
        role: UserRole.CUSTOMER,
      },
      select: { id: true, name: true, email: true, phone: true, role: true, status: true },
    });
    const session = await issueSession(user);
    res.status(201).json({ success: true, data: { user, ...session } });
  } catch (error) {
    if (duplicateAccountError(error)) {
      throw new HttpError(409, "An account with this phone number or email already exists.", "ACCOUNT_ALREADY_EXISTS");
    }
    throw error;
  }
}));

authRouter.post("/register/dealer", asyncHandler(async (req, res) => {
  const parsed = dealerRegistrationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Check the dealer registration details.", details: parsed.error.flatten().fieldErrors },
    });
    return;
  }

  const data = parsed.data;
  try {
    const user = await prisma.$transaction(async (tx) => {
      return tx.user.create({
        data: {
          name: data.name,
          phone: data.phone,
          ...(data.email ? { email: data.email.toLowerCase() } : {}),
          passwordHash: await bcrypt.hash(data.password, 12),
          role: UserRole.DEALER,
          dealerProfile: {
            create: {
              businessName: data.businessName,
              city: data.city,
              state: "Tamil Nadu",
              verificationStatus: "PENDING",
            },
          },
        },
        select: {
          id: true, name: true, email: true, phone: true, role: true, status: true,
          dealerProfile: { select: { id: true, businessName: true, city: true, verificationStatus: true } },
        },
      });
    });
    const session = await issueSession(user);
    res.status(201).json({ success: true, data: { user, ...session } });
  } catch (error) {
    if (duplicateAccountError(error)) {
      throw new HttpError(409, "An account with this phone number or email already exists.", "ACCOUNT_ALREADY_EXISTS");
    }
    throw error;
  }
}));

authRouter.post("/login", asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Enter your phone/email and password.", details: parsed.error.flatten().fieldErrors },
    });
    return;
  }

  const identifier = parsed.data.identifier;
  const user = await prisma.user.findFirst({
    where: { OR: [{ phone: identifier }, { email: identifier.toLowerCase() }] },
    select: {
      id: true, name: true, email: true, phone: true, passwordHash: true, role: true, status: true,
      dealerProfile: { select: { id: true, businessName: true, verificationStatus: true } },
    },
  });

  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    throw new HttpError(401, "The phone/email or password is incorrect.", "INVALID_CREDENTIALS");
  }
  if (user.status !== "ACTIVE") {
    throw new HttpError(403, "This account is not active. Contact support for assistance.", "ACCOUNT_INACTIVE");
  }

  const session = await issueSession(user);
  const { passwordHash: _passwordHash, ...safeUser } = user;
  res.status(200).json({ success: true, data: { user: safeUser, ...session } });
}));

authRouter.post("/refresh", asyncHandler(async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, "A valid refresh token is required.", "INVALID_REFRESH_TOKEN");
  }

  const tokenHash = hashToken(parsed.data.refreshToken);
  const stored = await prisma.refreshToken.findFirst({
    where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
    include: { user: { select: { id: true, role: true, status: true } } },
  });

  if (!stored || stored.user.status !== "ACTIVE") {
    throw new HttpError(401, "The refresh token is invalid or expired. Please sign in again.", "INVALID_REFRESH_TOKEN");
  }

  const nextRefreshToken = randomBytes(48).toString("base64url");
  const nextExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    const revoked = await tx.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count !== 1) {
      throw new HttpError(401, "The refresh token has already been used.", "REFRESH_TOKEN_REUSED");
    }
    await tx.refreshToken.create({
      data: { userId: stored.user.id, tokenHash: hashToken(nextRefreshToken), expiresAt: nextExpiresAt },
    });
  });

  const accessToken = jwt.sign(
    { role: stored.user.role },
    env.JWT_ACCESS_SECRET,
    { subject: stored.user.id, expiresIn: env.JWT_ACCESS_TTL_SECONDS },
  );

  res.status(200).json({
    success: true,
    data: { accessToken, refreshToken: nextRefreshToken, tokenType: "Bearer", expiresIn: env.JWT_ACCESS_TTL_SECONDS },
  });
}));

authRouter.post("/logout", asyncHandler(async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (parsed.success) {
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(parsed.data.refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  res.status(200).json({ success: true, data: { message: "Signed out." } });
}));

authRouter.get("/me", authenticate, asyncHandler(async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) throw new HttpError(401, "Authentication is required.", "UNAUTHENTICATED");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, name: true, email: true, phone: true, role: true, status: true, createdAt: true,
      dealerProfile: { select: { id: true, businessName: true, city: true, verificationStatus: true } },
    },
  });

  if (!user || user.status !== "ACTIVE") {
    throw new HttpError(401, "This account is no longer active.", "ACCOUNT_INACTIVE");
  }
  res.status(200).json({ success: true, data: user });
}));
