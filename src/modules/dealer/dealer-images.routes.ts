import { randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { env } from "../../config/env.js";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { HttpError } from "../../lib/http-error.js";
import { Dealer, Car, CarImage } from "../../lib/mongo.js";

export const dealerImagesRouter = Router();
dealerImagesRouter.use(authenticate, requireRole("DEALER"));

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new HttpError(400, "Choose JPG, PNG or WebP photos only.", "UNSUPPORTED_IMAGE_TYPE"));
      return;
    }
    callback(null, true);
  },
});

function makeImageUrl(req: import("express").Request, imageId: string) {
  // Production must use the explicitly configured public API origin. Do not trust
  // the incoming Host header when persisting URLs that will later be shown to users.
  const origin = env.PUBLIC_API_URL
    ?? (env.NODE_ENV !== "production" ? `${req.protocol}://${req.get("host")}` : "");
  if (!origin) {
    throw new HttpError(500, "Image delivery is not configured. Contact support.", "IMAGE_DELIVERY_NOT_CONFIGURED");
  }
  return `${origin}${env.API_BASE_PATH}/cars/images/${imageId}/content`;
}

function hasValidImageSignature(buffer: Buffer, mimeType: string) {
  if (mimeType === "image/jpeg") {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return buffer.length >= 8
      && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === "image/webp") {
    return buffer.length >= 12
      && buffer.toString("ascii", 0, 4) === "RIFF"
      && buffer.toString("ascii", 8, 12) === "WEBP";
  }
  return false;
}

async function ownedCar(carId: string | undefined, userId: string) {
  const parsed = z.string().uuid().safeParse(carId);
  if (!parsed.success) throw new HttpError(400, "The car ID is invalid.", "INVALID_CAR_ID");
  const dealer = await Dealer.findOne({ userId });
  if (!dealer) throw new HttpError(403, "A dealer profile is required.", "DEALER_PROFILE_REQUIRED");
  const car = await Car.findOne({ _id: parsed.data, dealerId: dealer.id });
  if (!car) throw new HttpError(404, "Vehicle not found in your inventory.", "CAR_NOT_FOUND");
  if (["SOLD", "ARCHIVED"].includes(car.status)) throw new HttpError(409, "Images cannot be changed for a sold or archived vehicle.", "CAR_NOT_EDITABLE");
  return car;
}

dealerImagesRouter.post("/:carId/images", upload.single("file"), asyncHandler(async (req, res) => {
  const car = await ownedCar(req.params.carId, req.auth!.userId);
  const file = req.file;
  if (!file) throw new HttpError(400, "Choose an image file to upload.", "IMAGE_FILE_REQUIRED");
  if (!hasValidImageSignature(file.buffer, file.mimetype)) {
    throw new HttpError(400, "The file contents do not match a supported image type.", "INVALID_IMAGE_CONTENT");
  }
  const count = await CarImage.countDocuments({ carId: car.id });
  if (count >= 12) throw new HttpError(409, "A listing can contain at most 12 photos.", "IMAGE_LIMIT_REACHED");

  const imageId = randomUUID();
  const isCover = req.body?.isCover === "true" || count === 0;
  if (isCover) await CarImage.updateMany({ carId: car.id }, { $set: { isCover: false } });
  const imageUrl = makeImageUrl(req, imageId);
  const image = await CarImage.create({
    _id: imageId,
    carId: car.id,
    imageUrl,
    contentType: file.mimetype,
    data: file.buffer,
    sizeBytes: file.size,
    sortOrder: Math.max(0, Math.min(20, Number.parseInt(req.body?.sortOrder ?? String(count), 10) || 0)),
    isCover,
  });
  res.status(201).json({
    success: true,
    data: { id: image.id, imageUrl: image.imageUrl, isCover: image.isCover, sortOrder: image.sortOrder },
  });
}));

dealerImagesRouter.delete("/:carId/images/:imageId", asyncHandler(async (req, res) => {
  const car = await ownedCar(req.params.carId, req.auth!.userId);
  const parsed = z.string().uuid().safeParse(req.params.imageId);
  if (!parsed.success) throw new HttpError(400, "The image ID is invalid.", "INVALID_IMAGE_ID");
  const image = await CarImage.findOne({ _id: parsed.data, carId: car.id });
  if (!image) throw new HttpError(404, "Image not found for this vehicle.", "IMAGE_NOT_FOUND");

  await image.deleteOne();
  if (image.isCover) {
    const next = await CarImage.findOne({ carId: car.id }).sort({ sortOrder: 1 });
    if (next) { next.isCover = true; await next.save(); }
  }
  res.status(200).json({ success: true, data: { id: image.id }, message: "Image removed." });
}));
