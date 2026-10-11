import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { listCarsQuerySchema } from "./cars.schemas.js";

export const carsRouter = Router();

carsRouter.get("/", async (req, res, next) => {
  const parsed = listCarsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: {
        code: "INVALID_QUERY",
        message: "One or more search filters are invalid.",
        details: parsed.error.flatten().fieldErrors,
      },
    });
    return;
  }

  try {
    const filters = parsed.data;
    const where: Prisma.CarWhereInput = {
      status: "AVAILABLE",
      publishedAt: { not: null },
      dealer: { verificationStatus: "APPROVED" },
      ...(filters.city ? { city: { contains: filters.city, mode: "insensitive" } } : {}),
      ...(filters.fuelType ? { fuelType: filters.fuelType } : {}),
      ...(filters.transmission ? { transmission: filters.transmission } : {}),
      ...(filters.brand ? { brand: { slug: filters.brand } } : {}),
      ...(filters.model ? { model: { slug: filters.model } } : {}),
      ...(filters.minPrice !== undefined || filters.maxPrice !== undefined
        ? { priceInr: {
            ...(filters.minPrice !== undefined ? { gte: new Prisma.Decimal(filters.minPrice) } : {}),
            ...(filters.maxPrice !== undefined ? { lte: new Prisma.Decimal(filters.maxPrice) } : {}),
          } }
        : {}),
      ...(filters.minYear !== undefined || filters.maxYear !== undefined
        ? { manufacturingYear: {
            ...(filters.minYear !== undefined ? { gte: filters.minYear } : {}),
            ...(filters.maxYear !== undefined ? { lte: filters.maxYear } : {}),
          } }
        : {}),
      ...(filters.q ? {
        OR: [
          { title: { contains: filters.q, mode: "insensitive" } },
          { description: { contains: filters.q, mode: "insensitive" } },
          { brand: { name: { contains: filters.q, mode: "insensitive" } } },
          { model: { name: { contains: filters.q, mode: "insensitive" } } },
          { variant: { contains: filters.q, mode: "insensitive" } },
        ],
      } : {}),
    };

    const orderBy: Prisma.CarOrderByWithRelationInput[] = (() => {
      switch (filters.sort) {
        case "price_asc": return [{ priceInr: "asc" }, { createdAt: "desc" }];
        case "price_desc": return [{ priceInr: "desc" }, { createdAt: "desc" }];
        case "year_desc": return [{ manufacturingYear: "desc" }, { createdAt: "desc" }];
        case "mileage_asc": return [{ mileageKm: "asc" }, { createdAt: "desc" }];
        default: return [{ publishedAt: "desc" }, { createdAt: "desc" }];
      }
    })();

    const [cars, total] = await prisma.$transaction([
      prisma.car.findMany({
        where,
        orderBy,
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
        select: {
          id: true,
          title: true,
          variant: true,
          priceInr: true,
          manufacturingYear: true,
          mileageKm: true,
          fuelType: true,
          transmission: true,
          city: true,
          state: true,
          publishedAt: true,
          brand: { select: { name: true, slug: true } },
          model: { select: { name: true, slug: true } },
          images: {
            orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }],
            take: 1,
            select: { imageUrl: true, isCover: true },
          },
          dealer: { select: { id: true, businessName: true, city: true } },
        },
      }),
      prisma.car.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: cars,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

carsRouter.get("/:id", async (req, res, next) => {
  const id = zUuid.safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_CAR_ID", message: "The car ID is invalid." },
    });
    return;
  }

  try {
    const car = await prisma.car.findFirst({
      where: {
        id: id.data,
        status: "AVAILABLE",
        publishedAt: { not: null },
        dealer: { verificationStatus: "APPROVED" },
      },
      select: {
        id: true, title: true, variant: true, description: true, priceInr: true,
        manufacturingYear: true, registrationYear: true, mileageKm: true,
        fuelType: true, transmission: true, bodyType: true, color: true,
        ownershipCount: true, registrationState: true, insuranceValidTill: true,
        city: true, state: true, publishedAt: true,
        brand: { select: { name: true, slug: true } },
        model: { select: { name: true, slug: true } },
        images: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }] },
        dealer: { select: { id: true, businessName: true, description: true, city: true, state: true } },
      },
    });

    if (!car) {
      res.status(404).json({
        success: false,
        error: { code: "CAR_NOT_FOUND", message: "This car is not available." },
      });
      return;
    }

    res.status(200).json({ success: true, data: car });
  } catch (error) {
    next(error);
  }
});

const zUuid = z.string().uuid();
