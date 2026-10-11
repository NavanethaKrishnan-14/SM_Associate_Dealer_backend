import { Router } from "express";
import { Prisma, UserRole } from "@prisma/client";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";

export const dealerCarsRouter = Router();
dealerCarsRouter.use(authenticate, requireRole(UserRole.DEALER));

const fuelTypeSchema = z.enum(["PETROL", "DIESEL", "CNG", "ELECTRIC", "HYBRID"]);
const transmissionSchema = z.enum(["MANUAL", "AUTOMATIC"]);
const yearSchema = z.coerce.number().int().min(1950).max(new Date().getFullYear() + 1);
const createCarSchema = z.object({
  brand: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(60),
  variant: z.string().trim().max(100).optional(),
  title: z.string().trim().min(3).max(160).optional(),
  description: z.string().trim().max(5000).optional(),
  priceInr: z.coerce.number().positive().max(100_000_000),
  manufacturingYear: yearSchema,
  registrationYear: yearSchema.optional(),
  mileageKm: z.coerce.number().int().min(0).max(2_000_000),
  fuelType: fuelTypeSchema,
  transmission: transmissionSchema,
  bodyType: z.string().trim().max(60).optional(),
  color: z.string().trim().max(60).optional(),
  ownershipCount: z.coerce.number().int().min(1).max(20).optional(),
  registrationState: z.string().trim().max(60).optional(),
  insuranceValidTill: z.coerce.date().optional(),
  city: z.string().trim().min(2).max(100).optional(),
  state: z.string().trim().min(2).max(100).default("Tamil Nadu"),
});

const updateCarSchema = z.object({
  variant: z.string().trim().max(100).nullable().optional(),
  title: z.string().trim().min(3).max(160).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  priceInr: z.coerce.number().positive().max(100_000_000).optional(),
  manufacturingYear: yearSchema.optional(),
  registrationYear: yearSchema.nullable().optional(),
  mileageKm: z.coerce.number().int().min(0).max(2_000_000).optional(),
  fuelType: fuelTypeSchema.optional(),
  transmission: transmissionSchema.optional(),
  bodyType: z.string().trim().max(60).nullable().optional(),
  color: z.string().trim().max(60).nullable().optional(),
  ownershipCount: z.coerce.number().int().min(1).max(20).nullable().optional(),
  registrationState: z.string().trim().max(60).nullable().optional(),
  insuranceValidTill: z.coerce.date().nullable().optional(),
  city: z.string().trim().min(2).max(100).optional(),
  state: z.string().trim().min(2).max(100).optional(),
}).refine((value) => Object.values(value).some((entry) => entry !== undefined), {
  message: "Provide at least one field to update.",
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(["DRAFT", "PENDING_APPROVAL", "AVAILABLE", "RESERVED", "SOLD", "REJECTED", "ARCHIVED"]).optional(),
});

const statusSchema = z.object({
  status: z.enum(["DRAFT", "PENDING_APPROVAL", "RESERVED", "SOLD", "ARCHIVED"]),
});

const slugify = (value: string) =>
  value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

async function requireDealerProfile(userId: string) {
  const dealer = await prisma.dealer.findUnique({
    where: { userId },
    select: { id: true, city: true, verificationStatus: true },
  });
  if (!dealer) throw new HttpError(403, "A dealer profile is required to manage inventory.", "DEALER_PROFILE_REQUIRED");
  return dealer;
}

function parseUuid(value: string | undefined) {
  const result = z.string().uuid().safeParse(value);
  if (!result.success) throw new HttpError(400, "The car ID is invalid.", "INVALID_CAR_ID");
  return result.data;
}

dealerCarsRouter.get("/", asyncHandler(async (req, res) => {
  const query = listQuerySchema.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ success: false, error: { code: "INVALID_QUERY", message: "Invalid inventory filters.", details: query.error.flatten().fieldErrors } });
    return;
  }

  const dealer = await requireDealerProfile(req.auth!.userId);
  const { page, limit, status } = query.data;
  const where: Prisma.CarWhereInput = { dealerId: dealer.id, ...(status ? { status } : {}) };
  const [items, total] = await prisma.$transaction([
    prisma.car.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        brand: { select: { id: true, name: true, slug: true } },
        model: { select: { id: true, name: true, slug: true } },
        images: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }] },
      },
    }),
    prisma.car.count({ where }),
  ]);

  res.status(200).json({
    success: true,
    data: items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}));

dealerCarsRouter.post("/", asyncHandler(async (req, res) => {
  const parsed = createCarSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Check the vehicle details.", details: parsed.error.flatten().fieldErrors } });
    return;
  }

  const dealer = await requireDealerProfile(req.auth!.userId);
  const data = parsed.data;
  const brandName = data.brand.trim();
  const modelName = data.model.trim();
  const brandSlug = slugify(brandName);
  const modelSlug = slugify(modelName);

  if (!brandSlug || !modelSlug) {
    throw new HttpError(400, "Enter a valid vehicle brand and model.", "INVALID_BRAND_OR_MODEL");
  }

  const car = await prisma.$transaction(async (tx) => {
    const brand = await tx.brand.upsert({
      where: { slug: brandSlug },
      update: {},
      create: { name: brandName, slug: brandSlug },
    });
    const model = await tx.carModel.upsert({
      where: { brandId_slug: { brandId: brand.id, slug: modelSlug } },
      update: {},
      create: { brandId: brand.id, name: modelName, slug: modelSlug },
    });

    return tx.car.create({
      data: {
        dealerId: dealer.id,
        brandId: brand.id,
        modelId: model.id,
        title: data.title ?? [brand.name, model.name, data.variant].filter(Boolean).join(" "),
        ...(data.variant !== undefined ? { variant: data.variant } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        priceInr: new Prisma.Decimal(data.priceInr),
        manufacturingYear: data.manufacturingYear,
        ...(data.registrationYear !== undefined ? { registrationYear: data.registrationYear } : {}),
        mileageKm: data.mileageKm,
        fuelType: data.fuelType,
        transmission: data.transmission,
        ...(data.bodyType !== undefined ? { bodyType: data.bodyType } : {}),
        ...(data.color !== undefined ? { color: data.color } : {}),
        ...(data.ownershipCount !== undefined ? { ownershipCount: data.ownershipCount } : {}),
        ...(data.registrationState !== undefined ? { registrationState: data.registrationState } : {}),
        ...(data.insuranceValidTill !== undefined ? { insuranceValidTill: data.insuranceValidTill } : {}),
        city: data.city ?? dealer.city,
        state: data.state,
        status: "DRAFT",
      },
      include: {
        brand: { select: { id: true, name: true, slug: true } },
        model: { select: { id: true, name: true, slug: true } },
        images: true,
      },
    });
  });

  res.status(201).json({ success: true, data: car, message: "Vehicle saved as a draft. Add photos and submit it for review." });
}));

dealerCarsRouter.patch("/:id", asyncHandler(async (req, res) => {
  const id = parseUuid(req.params.id);
  const parsed = updateCarSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Check the vehicle details.", details: parsed.error.flatten().fieldErrors } });
    return;
  }

  const dealer = await requireDealerProfile(req.auth!.userId);
  const existing = await prisma.car.findFirst({ where: { id, dealerId: dealer.id } });
  if (!existing) throw new HttpError(404, "Vehicle not found in your inventory.", "CAR_NOT_FOUND");
  if (existing.status === "SOLD" || existing.status === "ARCHIVED") {
    throw new HttpError(409, "Sold or archived vehicles cannot be edited.", "CAR_NOT_EDITABLE");
  }

  const data = parsed.data;
  const car = await prisma.car.update({
    where: { id },
    data: {
      ...(data.variant !== undefined ? { variant: data.variant } : {}),
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.priceInr !== undefined ? { priceInr: new Prisma.Decimal(data.priceInr) } : {}),
      ...(data.manufacturingYear !== undefined ? { manufacturingYear: data.manufacturingYear } : {}),
      ...(data.registrationYear !== undefined ? { registrationYear: data.registrationYear } : {}),
      ...(data.mileageKm !== undefined ? { mileageKm: data.mileageKm } : {}),
      ...(data.fuelType !== undefined ? { fuelType: data.fuelType } : {}),
      ...(data.transmission !== undefined ? { transmission: data.transmission } : {}),
      ...(data.bodyType !== undefined ? { bodyType: data.bodyType } : {}),
      ...(data.color !== undefined ? { color: data.color } : {}),
      ...(data.ownershipCount !== undefined ? { ownershipCount: data.ownershipCount } : {}),
      ...(data.registrationState !== undefined ? { registrationState: data.registrationState } : {}),
      ...(data.insuranceValidTill !== undefined ? { insuranceValidTill: data.insuranceValidTill } : {}),
      ...(data.city !== undefined ? { city: data.city } : {}),
      ...(data.state !== undefined ? { state: data.state } : {}),
      ...(existing.status === "AVAILABLE" ? { status: "PENDING_APPROVAL", publishedAt: null } : {}),
      ...(existing.status === "REJECTED" ? { status: "DRAFT" } : {}),
    },
    include: {
      brand: { select: { id: true, name: true, slug: true } },
      model: { select: { id: true, name: true, slug: true } },
      images: true,
    },
  });

  res.status(200).json({ success: true, data: car, message: "Vehicle details updated." });
}));

dealerCarsRouter.patch("/:id/status", asyncHandler(async (req, res) => {
  const id = parseUuid(req.params.id);
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "INVALID_STATUS", message: "The requested status is not allowed." } });
    return;
  }

  const dealer = await requireDealerProfile(req.auth!.userId);
  const car = await prisma.car.findFirst({ where: { id, dealerId: dealer.id } });
  if (!car) throw new HttpError(404, "Vehicle not found in your inventory.", "CAR_NOT_FOUND");

  const requested = parsed.data.status;
  const allowed =
    (requested === "PENDING_APPROVAL" && (car.status === "DRAFT" || car.status === "REJECTED")) ||
    (requested === "RESERVED" && car.status === "AVAILABLE") ||
    (requested === "SOLD" && (car.status === "AVAILABLE" || car.status === "RESERVED")) ||
    (requested === "DRAFT" && (car.status === "REJECTED" || car.status === "PENDING_APPROVAL")) ||
    (requested === "ARCHIVED" && car.status !== "ARCHIVED");

  if (!allowed) {
    throw new HttpError(409, "This vehicle cannot move to the requested status. Listings become available only after admin approval.", "INVALID_STATUS_TRANSITION");
  }

  const updated = await prisma.car.update({
    where: { id },
    data: {
      status: requested,
      ...(requested === "SOLD" ? { soldAt: new Date() } : {}),
      ...(requested === "RESERVED" ? { reservedAt: new Date() } : {}),
    },
  });

  res.status(200).json({ success: true, data: updated });
}));

dealerCarsRouter.delete("/:id", asyncHandler(async (req, res) => {
  const id = parseUuid(req.params.id);
  const dealer = await requireDealerProfile(req.auth!.userId);
  const car = await prisma.car.findFirst({ where: { id, dealerId: dealer.id } });
  if (!car) throw new HttpError(404, "Vehicle not found in your inventory.", "CAR_NOT_FOUND");
  if (car.status === "SOLD") {
    throw new HttpError(409, "Sold vehicle history is preserved and cannot be archived from this action.", "SOLD_CAR_HISTORY_PROTECTED");
  }

  const archived = await prisma.car.update({ where: { id }, data: { status: "ARCHIVED" } });
  res.status(200).json({ success: true, data: archived, message: "Vehicle archived. Enquiry history has been preserved." });
}));
