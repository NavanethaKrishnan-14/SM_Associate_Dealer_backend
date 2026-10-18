import mongoose, { Schema, type Model } from "mongoose";
import { env } from "../config/env.js";

const id = { type: String };
const counterSchema = new Schema({ _id: { type: String }, seq: { type: Number, default: 0 } }, { versionKey: false });
const Counter = (mongoose.models["IdCounter"] as Model<any>) ?? mongoose.model("IdCounter", counterSchema, "id_counters");

async function nextId(prefix: string): Promise<string> {
  const counter = await Counter.findOneAndUpdate(
    { _id: prefix },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
  return `${prefix}-${String(counter.seq).padStart(3, "0")}`;
}

function assignId(schema: Schema, prefixFor: (doc: any) => string) {
  schema.pre("validate", async function () {
    if (!this._id) this._id = await nextId(prefixFor(this));
  });
}
const opts: any = { timestamps: true, versionKey: false, strict: false, minimize: false, toJSON: { virtuals: true, transform: (_doc: unknown, ret: Record<string, any>) => { if (ret._id !== undefined) { ret.id = String(ret._id); delete ret._id; } delete ret.__v; return ret; } }, toObject: { virtuals: true } };
const make = (name: string, schema: Schema): any => (mongoose.models[name] as Model<any>) ?? mongoose.model(name, schema);
const userSchema = new Schema({ _id: id, name: { type: String, required: true }, email: { type: String, unique: true, sparse: true, lowercase: true }, phone: { type: String, required: false, unique: true, sparse: true }, passwordHash: { type: String, required: false }, googleId: { type: String, unique: true, sparse: true }, facebookId: { type: String, unique: true, sparse: true }, role: { type: String, enum: ["CUSTOMER","DEALER","ADMIN"], default: "CUSTOMER" }, status: { type: String, enum: ["ACTIVE","SUSPENDED","PENDING_VERIFICATION"], default: "ACTIVE" } }, opts);
const dealerSchema = new Schema({ _id: id, userId: { type: String, ref: "User", required: true, unique: true }, businessName: { type: String, required: true }, description: String, addressLine: String, city: { type: String, required: true }, state: { type: String, default: "Tamil Nadu" }, postalCode: String, verificationStatus: { type: String, enum: ["PENDING","APPROVED","REJECTED","SUSPENDED"], default: "PENDING" }, verifiedAt: Date }, opts);
const brandSchema = new Schema({ _id: id, name: { type: String, required: true, unique: true }, slug: { type: String, required: true, unique: true } }, opts);
const modelSchema = new Schema({ _id: id, brandId: { type: String, ref: "Brand", required: true }, name: { type: String, required: true }, slug: { type: String, required: true } }, opts);
modelSchema.index({ brandId: 1, slug: 1 }, { unique: true });
const carSchema = new Schema({ _id: id, dealerId: { type: String, ref: "Dealer", required: true }, brandId: { type: String, ref: "Brand", required: true }, modelId: { type: String, ref: "CarModel", required: true }, variant: String, title: { type: String, required: true }, description: String, priceInr: { type: Number, required: true }, manufacturingYear: { type: Number, required: true }, registrationYear: Number, mileageKm: { type: Number, required: true }, fuelType: { type: String, enum: ["PETROL","DIESEL","CNG","ELECTRIC","HYBRID"], required: true }, transmission: { type: String, enum: ["MANUAL","AUTOMATIC"], required: true }, bodyType: String, color: String, ownershipCount: Number, registrationState: String, insuranceValidTill: Date, city: { type: String, required: true }, state: { type: String, default: "Tamil Nadu" }, status: { type: String, enum: ["DRAFT","PENDING_APPROVAL","AVAILABLE","RESERVED","SOLD","REJECTED","ARCHIVED"], default: "DRAFT" }, publishedAt: Date, moderationNote: String, reservedAt: Date, soldAt: Date }, opts);
carSchema.index({ status: 1, city: 1, priceInr: 1 }); carSchema.index({ dealerId: 1, status: 1, createdAt: -1 });
const imageSchema = new Schema({ _id: id, carId: { type: String, ref: "Car", required: true }, imageUrl: { type: String, required: true }, contentType: String, data: Buffer, sizeBytes: Number, sortOrder: { type: Number, default: 0 }, isCover: { type: Boolean, default: false } }, opts);
const favoriteSchema = new Schema({ _id: id, userId: { type: String, ref: "User", required: true }, carId: { type: String, ref: "Car", required: true } }, opts); favoriteSchema.index({ userId: 1, carId: 1 }, { unique: true });
const enquirySchema = new Schema({ _id: id, carId: { type: String, ref: "Car" }, customerId: { type: String, ref: "User" }, contactName: { type: String, trim: true }, contactPhone: { type: String, trim: true }, dealerId: { type: String, ref: "Dealer" }, message: { type: String, required: true }, enquiryType: { type: String, enum: ["CAR_ENQUIRY","SELL_CAR"], default: "CAR_ENQUIRY" }, status: { type: String, enum: ["NEW","OPEN","CONTACTED","IN_PROGRESS","CLOSED"], default: "NEW" }, contactedAt: Date, closedAt: Date }, opts);
const testDriveSchema = new Schema({ _id: id, carId: { type: String, ref: "Car", required: true }, customerId: { type: String, ref: "User", required: true }, dealerId: { type: String, ref: "Dealer", required: true }, scheduledAt: { type: Date, required: true }, status: { type: String, enum: ["REQUESTED","CONFIRMED","COMPLETED","CANCELLED"], default: "REQUESTED" }, notes: String }, opts);
const notificationSchema = new Schema({ _id: id, userId: { type: String, ref: "User", required: true }, title: String, body: String, data: Schema.Types.Mixed, readAt: Date }, opts);
const reportSchema = new Schema({ _id: id, carId: { type: String, ref: "Car", required: true }, reporterId: { type: String, ref: "User", required: true }, reason: { type: String, required: true }, details: String, status: { type: String, default: "OPEN" }, resolvedAt: Date }, opts);
const refreshSchema = new Schema({ _id: id, userId: { type: String, ref: "User", required: true }, tokenHash: { type: String, required: true, unique: true }, expiresAt: { type: Date, required: true }, revokedAt: Date }, opts);
refreshSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const expenseSchema = new Schema({ _id: id, dealerId: { type: String, ref: "Dealer", required: true }, carId: { type: String, ref: "Car", required: true }, category: { type: String, required: true }, amount: { type: Number, required: true, min: 0.01 }, note: String }, opts);
expenseSchema.index({ dealerId: 1, carId: 1, createdAt: -1 });
const saleSchema = new Schema({ _id: id, dealerId: { type: String, ref: "Dealer", required: true }, carId: { type: String, ref: "Car", required: true, unique: true }, salePrice: { type: Number, required: true, min: 0.01 }, acquisitionCost: { type: Number, required: true, min: 0 }, expensesTotal: { type: Number, required: true, min: 0 }, profit: { type: Number, required: true }, soldAt: { type: Date, required: true } }, opts);
saleSchema.index({ dealerId: 1, soldAt: -1 });
const auditSchema = new Schema({ _id: id, actorId: { type: String, ref: "User" }, action: String, entityType: String, entityId: String, details: Schema.Types.Mixed }, opts);

assignId(userSchema, (doc) => doc.role === "DEALER" ? "DLR" : doc.role === "ADMIN" ? "ADM" : "CUS");
assignId(dealerSchema, () => "DLP");
assignId(brandSchema, () => "BRD");
assignId(modelSchema, () => "MOD");
assignId(carSchema, () => "CAR");
assignId(imageSchema, () => "IMG");
assignId(favoriteSchema, () => "FAV");
assignId(enquirySchema, () => "ENQ");
assignId(testDriveSchema, () => "TDR");
assignId(notificationSchema, () => "NOT");
assignId(reportSchema, () => "RPT");
assignId(refreshSchema, () => "RFT");
assignId(auditSchema, () => "AUD");
assignId(expenseSchema, () => "EXP");
assignId(saleSchema, () => "SAL");
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
export const VehicleExpense = make("VehicleExpense", expenseSchema);
export const VehicleSale = make("VehicleSale", saleSchema);
/**
 * Reconcile legacy indexes before Mongoose runs auto-index creation.
 *
 * Older deployments may have created a unique, non-sparse phone_1 index.
 * The current schema intentionally uses a sparse unique phone index because
 * phone is optional for some account flows. MongoDB rejects createIndex when
 * the same index name/key already exists with different options.
 *
 * Only drop the exact conflicting index; no user documents are modified.
 */
async function reconcileLegacyUserIndexes() {
  let indexes;
  try {
    indexes = await User.collection.indexes();
  } catch (error) {
    // A brand-new database may not have a users collection yet. In that case,
    // Mongoose will create the collection and its indexes during User.init().
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: number }).code === 26
    ) {
      return;
    }
    throw error;
  }

  const phoneIndex = indexes.find(
    (index: {
      name?: string;
      unique?: boolean;
      key?: Record<string, unknown>;
      sparse?: boolean;
    }) =>
      index.name === "phone_1" &&
      index.unique === true &&
      index.key !== undefined &&
      Object.keys(index.key).length === 1 &&
      index.key.phone === 1 &&
      index.sparse !== true,
  );

  if (phoneIndex?.name) {
    console.warn(
      'Reconciling legacy MongoDB index "phone_1" (unique, non-sparse) to match the current sparse unique schema.',
    );
    await User.collection.dropIndex(phoneIndex.name);
  }
}

export async function connectMongo() {
  if (!env.MONGODB_URI) throw new Error("MONGODB_URI is required.");
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    await reconcileLegacyUserIndexes();
    await Promise.all([User.init(), Dealer.init(), Brand.init(), CarModel.init(), Car.init(), CarImage.init(), Favorite.init(), Enquiry.init(), TestDrive.init(), Notification.init(), CarReport.init(), RefreshToken.init(), AuditLog.init(), VehicleExpense.init(), VehicleSale.init()]);
  } catch (error) {
    await mongoose.disconnect().catch(() => undefined);
    throw error;
  }
}
export async function disconnectMongo() { await mongoose.disconnect(); }
export function serialize<T extends Record<string, any>>(doc: T): any {
  if (!doc) return doc;
  const obj = typeof doc.toObject === "function" ? doc.toObject({ virtuals: false }) : { ...doc };
  if (obj._id !== undefined) { obj.id = String(obj._id); delete obj._id; }
  delete obj.__v;
  return obj;
}
