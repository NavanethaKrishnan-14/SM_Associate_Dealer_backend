import { randomUUID } from "node:crypto";
import { Router } from "express";
import { UserRole } from "@prisma/client";
import { v2 as cloudinary } from "cloudinary";
import { z } from "zod";
import { env } from "../../config/env.js";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";

export const dealerImagesRouter = Router();
dealerImagesRouter.use(authenticate, requireRole(UserRole.DEALER));

const imageMetadataSchema = z.object({
  imageUrl: z.string().url().max(2048),
  publicId: z.string().trim().min(3).max(500),
  isCover: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).max(20).default(0),
});

function cloudinaryConfig() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new HttpError(503, "Cloud image storage is not configured. Contact the platform administrator.", "IMAGE_STORAGE_NOT_CONFIGURED");
  }
  return { cloudName: CLOUDINARY_CLOUD_NAME, apiKey: CLOUDINARY_API_KEY, apiSecret: CLOUDINARY_API_SECRET };
}

async function ownedCar(carId: string | undefined, userId: string) {
  const idResult = z.string().uuid().safeParse(carId);
  if (!idResult.success) throw new HttpError(400, "The car ID is invalid.", "INVALID_CAR_ID");
  const dealer = await prisma.dealer.findUnique({ where: { userId }, select: { id: true } });
  if (!dealer) throw new HttpError(403, "A dealer profile is required.", "DEALER_PROFILE_REQUIRED");
  const car = await prisma.car.findFirst({ where: { id: idResult.data, dealerId: dealer.id } });
  if (!car) throw new HttpError(404, "Vehicle not found in your inventory.", "CAR_NOT_FOUND");
  if (car.status === "SOLD" || car.status === "ARCHIVED") {
    throw new HttpError(409, "Images cannot be changed for a sold or archived vehicle.", "CAR_NOT_EDITABLE");
  }
  return car;
}

dealerImagesRouter.post("/:carId/images/signature", asyncHandler(async (req, res) => {
  const car = await ownedCar(req.params.carId, req.auth!.userId);
  const count = await prisma.carImage.count({ where: { carId: car.id } });
  if (count >= 12) throw new HttpError(409, "A listing can contain at most 12 photos.", "IMAGE_LIMIT_REACHED");

  const config = cloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `sm-associate-cars/cars/${car.id}`;
  const publicId = `${car.id}_${randomUUID()}`;
  const params = { folder, public_id: publicId, timestamp };
  const signature = cloudinary.utils.api_sign_request(params, config.apiSecret);

  res.status(200).json({
    success: true,
    data: {
      cloudName: config.cloudName,
      apiKey: config.apiKey,
      timestamp,
      folder,
      publicId,
      signature,
      uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`,
      maxFileBytes: 10 * 1024 * 1024,
      allowedFormats: ["jpg", "jpeg", "png", "webp"],
    },
  });
}));

dealerImagesRouter.post("/:carId/images", asyncHandler(async (req, res) => {
  const car = await ownedCar(req.params.carId, req.auth!.userId);
  const parsed = imageMetadataSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Check the uploaded image details.", details: parsed.error.flatten().fieldErrors } });
    return;
  }

  const config = cloudinaryConfig();
  let imageUrl: URL;
  try {
    imageUrl = new URL(parsed.data.imageUrl);
  } catch {
    throw new HttpError(400, "The image URL is invalid.", "INVALID_IMAGE_URL");
  }

  const expectedPathPrefix = `/${config.cloudName}/image/upload/`;
  const publicIdLastPart = parsed.data.publicId.split("/").pop() ?? "";
  if (
    imageUrl.protocol !== "https:" ||
    imageUrl.hostname !== "res.cloudinary.com" ||
    !imageUrl.pathname.startsWith(expectedPathPrefix) ||
    !publicIdLastPart.startsWith(`${car.id}_`)
  ) {
    throw new HttpError(400, "The image must belong to this car's signed Cloudinary upload.", "UNTRUSTED_IMAGE");
  }

  const count = await prisma.carImage.count({ where: { carId: car.id } });
  if (count >= 12) throw new HttpError(409, "A listing can contain at most 12 photos.", "IMAGE_LIMIT_REACHED");

  const isCover = parsed.data.isCover || count === 0;
  const image = await prisma.$transaction(async (tx) => {
    if (isCover) {
      await tx.carImage.updateMany({ where: { carId: car.id }, data: { isCover: false } });
    }
    return tx.carImage.create({
      data: {
        carId: car.id,
        imageUrl: parsed.data.imageUrl,
        publicId: parsed.data.publicId,
        isCover,
        sortOrder: parsed.data.sortOrder,
      },
    });
  });

  res.status(201).json({ success: true, data: image });
}));

dealerImagesRouter.delete("/:carId/images/:imageId", asyncHandler(async (req, res) => {
  const car = await ownedCar(req.params.carId, req.auth!.userId);
  const imageId = z.string().uuid().safeParse(req.params.imageId);
  if (!imageId.success) throw new HttpError(400, "The image ID is invalid.", "INVALID_IMAGE_ID");
  const image = await prisma.carImage.findFirst({ where: { id: imageId.data, carId: car.id } });
  if (!image) throw new HttpError(404, "Image not found for this vehicle.", "IMAGE_NOT_FOUND");

  const config = cloudinaryConfig();
  const destroyed = await cloudinary.uploader.destroy(image.publicId, { resource_type: "image" });
  if (destroyed.result !== "ok" && destroyed.result !== "not found") {
    throw new HttpError(502, "The image could not be removed from cloud storage.", "IMAGE_DELETE_FAILED");
  }

  await prisma.carImage.delete({ where: { id: image.id } });
  if (image.isCover) {
    const nextCover = await prisma.carImage.findFirst({ where: { carId: car.id }, orderBy: { sortOrder: "asc" } });
    if (nextCover) await prisma.carImage.update({ where: { id: nextCover.id }, data: { isCover: true } });
  }

  res.status(200).json({ success: true, data: { id: image.id }, message: "Image removed." });
}));
