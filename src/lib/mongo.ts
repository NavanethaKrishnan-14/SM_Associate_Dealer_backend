import mongoose, { Schema, type Model } from "mongoose";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";

const id = { type: String, default: randomUUID };
const opts: any = { timestamps: true, versionKey: false, strict: false, minimize: false, toJSON: { virtuals: true, transform: (_doc: unknown, ret: Record<string, any>) => { if (ret._id !== undefined) { ret.id = String(ret._id); delete ret._id; } delete ret.__v; return ret; } }, toObject: { virtuals: true } };
const make = (name: string, schema: Schema): any => (mongoose.models[name] as Model<any>) ?? mongoose.model(name, schema);
const userSchema = new Schema({ _id: id, name: { type: String, required: true }, email: { type: String, unique: true, sparse: true, lowercase: true }, phone: { type: String, required: true, unique: true }, passwordHash: { type: String, required: true }, role: { type: String, enum: ["CUSTOMER","DEALER","ADMIN","SUPER_ADMIN"], default: "CUSTOMER" }, status: { type: String, enum: ["ACTIVE","SUSPENDED","PENDING_VERIFICATION"], default: "ACTIVE" } }, opts);
const dealerSchema = new Schema({ _id: id, userId: { type: String, ref: "User", required: true, unique: true }, businessName: { type: String, required: true }, description: String, addressLine: String, city: { type: String, required: true }, state: { type: String, default: "Tamil Nadu" }, postalCode: String, verificationStatus: { type: String, enum: ["PENDING","APPROVED","REJECTED","SUSPENDED"], default: "PENDING" }, verifiedAt: Date }, opts);
const brandSchema = new Schema({ _id: id, name: { type: String, required: true, unique: true }, slug: { type: String, required: true, unique: true } }, opts);
const modelSchema = new Schema({ _id: id, brandId: { type: String, ref: "Brand", required: true }, name: { type: String, required: true }, slug: { type: String, required: true } }, opts);
modelSchema.index({ brandId: 1, slug: 1 }, { unique: true });
const carSchema = new Schema({ _id: id, dealerId: { type: String, ref: "Dealer", required: true }, brandId: { type: String, ref: "Brand", required: true }, modelId: { type: String, ref: "CarModel", required: true }, variant: String, title: { type: String, required: true }, description: String, priceInr: { type: Number, required: true }, manufacturingYear: { type: Number, required: true }, registrationYear: Number, mileageKm: { type: Number, required: true }, fuelType: { type: String, enum: ["PETROL","DIESEL","CNG","ELECTRIC","HYBRID"], required: true }, transmission: { type: String, enum: ["MANUAL","AUTOMATIC"], required: true }, bodyType: String, color: String, ownershipCount: Number, registrationState: String, insuranceValidTill: Date, city: { type: String, required: true }, state: { type: String, default: "Tamil Nadu" }, status: { type: String, enum: ["DRAFT","PENDING_APPROVAL","AVAILABLE","RESERVED","SOLD","REJECTED","ARCHIVED"], default: "DRAFT" }, publishedAt: Date, moderationNote: String, reservedAt: Date, soldAt: Date }, opts);
carSchema.index({ status: 1, city: 1, priceInr: 1 }); carSchema.index({ dealerId: 1, status: 1, createdAt: -1 });
const imageSchema = new Schema({ _id: id, carId: { type: String, ref: "Car", required: true }, imageUrl: { type: String, required: true }, contentType: String, data: Buffer, sizeBytes: Number, sortOrder: { type: Number, default: 0 }, isCover: { type: Boolean, default: false } }, opts);
const favoriteSchema = new Schema({ _id: id, userId: { type: String, ref: "User", required: true }, carId: { type: String, ref: "Car", required: true } }, opts); favoriteSchema.index({ userId: 1, carId: 1 }, { unique: true });
const enquirySchema = new Schema({ _id: id, carId: { type: String, ref: "Car", required: true }, customerId: { type: String, ref: "User", required: true }, dealerId: { type: String, ref: "Dealer", required: true }, message: { type: String, required: true }, status: { type: String, enum: ["NEW","CONTACTED","IN_PROGRESS","CLOSED"], default: "NEW" }, contactedAt: Date, closedAt: Date }, opts);
const testDriveSchema = new Schema({ _id: id, carId: { type: String, ref: "Car", required: true }, customerId: { type: String, ref: "User", required: true }, dealerId: { type: String, ref: "Dealer", required: true }, scheduledAt: { type: Date, required: true }, status: { type: String, enum: ["REQUESTED","CONFIRMED","COMPLETED","CANCELLED"], default: "REQUESTED" }, notes: String }, opts);
const notificationSchema = new Schema({ _id: id, userId: { type: String, ref: "User", required: true }, title: String, body: String, data: Schema.Types.Mixed, readAt: Date }, opts);
const reportSchema = new Schema({ _id: id, carId: { type: String, ref: "Car", required: true }, reporterId: { type: String, ref: "User", required: true }, reason: { type: String, required: true }, details: String, status: { type: String, default: "OPEN" }, resolvedAt: Date }, opts);
const refreshSchema = new Schema({ _id: id, userId: { type: String, ref: "User", required: true }, tokenHash: { type: String, required: true, unique: true }, expiresAt: { type: Date, required: true }, revokedAt: Date }, opts);
const auditSchema = new Schema({ _id: id, actorId: { type: String, ref: "User" }, action: String, entityType: String, entityId: String, details: Schema.Types.Mixed }, opts);
export const User = make("User", userSchema);
export const Dealer = make("Dealer", dealerSchema);
export const Brand = make("Brand", brandSchema);
export const CarModel = make("CarModel", modelSchema);
export const Car = make("Car", carSchema);
export const CarImage = make("CarImage", imageSchema);
export const Favorite = make("Favorite", favoriteSchema);
export const Enquiry = make("Enquiry", enquirySchema);
export const TestDrive = make("TestDrive", testDriveSchema);
export const Notification = make("Notification", notificationSchema);
export const CarReport = make("CarReport", reportSchema);
export const RefreshToken = make("RefreshToken", refreshSchema);
export const AuditLog = make("AuditLog", auditSchema);
export async function connectMongo() {
  if (!env.MONGODB_URI) throw new Error("MONGODB_URI is required.");
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await Promise.all([User.init(), Dealer.init(), Brand.init(), CarModel.init(), Car.init(), CarImage.init(), Favorite.init(), Enquiry.init(), TestDrive.init(), Notification.init(), CarReport.init(), RefreshToken.init(), AuditLog.init()]);
}
export async function disconnectMongo() { await mongoose.disconnect(); }
export function serialize<T extends Record<string, any>>(doc: T): any {
  if (!doc) return doc;
  const obj = typeof doc.toObject === "function" ? doc.toObject({ virtuals: false }) : { ...doc };
  if (obj._id !== undefined) { obj.id = String(obj._id); delete obj._id; }
  delete obj.__v;
  return obj;
}
