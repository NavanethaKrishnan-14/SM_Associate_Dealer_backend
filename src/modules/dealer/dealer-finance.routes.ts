import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { HttpError } from "../../lib/http-error.js";
import { Car, Dealer, VehicleExpense, VehicleSale } from "../../lib/mongo.js";

export const dealerFinanceRouter = Router();
dealerFinanceRouter.use(authenticate, requireRole("DEALER"));

const idSchema = z.string().regex(/^(?:[A-Z]{3,4}-\d{3,}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
const expenseSchema = z.object({
  carId: idSchema,
  category: z.string().trim().min(2).max(60),
  amount: z.coerce.number().positive().max(100_000_000),
  note: z.string().trim().max(1000).optional(),
});
const saleSchema = z.object({
  carId: idSchema,
  salePrice: z.coerce.number().positive().max(100_000_000),
  acquisitionCost: z.coerce.number().min(0).max(100_000_000),
});

async function getDealer(userId: string) {
  const dealer = await Dealer.findOne({ userId });
  if (!dealer) throw new HttpError(403, "A dealer profile is required to manage finances.", "DEALER_PROFILE_REQUIRED");
  return dealer;
}

async function getOwnedCar(carId: string, dealerId: string) {
  const car = await Car.findOne({ _id: carId, dealerId });
  if (!car) throw new HttpError(404, "Vehicle not found in your inventory.", "CAR_NOT_FOUND");
  return car;
}

dealerFinanceRouter.get("/expenses", asyncHandler(async (req, res) => {
  const dealer = await getDealer(req.auth!.userId);
  const items = await VehicleExpense.find({ dealerId: dealer.id }).sort({ createdAt: -1 }).limit(500).lean();
  const data = await Promise.all(items.map(async (item: any) => {
    const car = await Car.findById(item.carId).select("title").lean();
    return { id: String(item._id), carId: item.carId, carTitle: car?.title ?? "Vehicle", category: item.category, amount: item.amount, note: item.note ?? "", date: item.createdAt, createdAt: item.createdAt };
  }));
  res.status(200).json({ success: true, data });
}));

dealerFinanceRouter.post("/expenses", asyncHandler(async (req, res) => {
  const parsed = expenseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Enter a vehicle, expense category and valid amount.", details: parsed.error.flatten().fieldErrors } });
    return;
  }
  const dealer = await getDealer(req.auth!.userId);
  const car = await getOwnedCar(parsed.data.carId, dealer.id);
  if (["SOLD", "ARCHIVED"].includes(car.status)) throw new HttpError(409, "Expenses cannot be added to a sold or archived vehicle.", "CAR_NOT_EDITABLE");
  const item = await VehicleExpense.create({ dealerId: dealer.id, carId: car.id, category: parsed.data.category, amount: parsed.data.amount, ...(parsed.data.note ? { note: parsed.data.note } : {}) });
  res.status(201).json({ success: true, data: { id: item.id, carId: car.id, carTitle: car.title, category: item.category, amount: item.amount, note: item.note ?? "", date: item.createdAt, createdAt: item.createdAt } });
}));

dealerFinanceRouter.get("/sales", asyncHandler(async (req, res) => {
  const dealer = await getDealer(req.auth!.userId);
  const items = await VehicleSale.find({ dealerId: dealer.id }).sort({ soldAt: -1 }).limit(500).lean();
  const data = await Promise.all(items.map(async (item: any) => {
    const car = await Car.findById(item.carId).select("title").lean();
    return { id: String(item._id), carId: item.carId, title: car?.title ?? "Vehicle", carTitle: car?.title ?? "Vehicle", price: item.salePrice, salePrice: item.salePrice, cost: item.acquisitionCost, acquisitionCost: item.acquisitionCost, expenses: item.expensesTotal, profit: item.profit, date: item.soldAt, soldAt: item.soldAt };
  }));
  res.status(200).json({ success: true, data });
}));

dealerFinanceRouter.post("/sales", asyncHandler(async (req, res) => {
  const parsed = saleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Choose a vehicle and enter valid sale and acquisition prices.", details: parsed.error.flatten().fieldErrors } });
    return;
  }
  const dealer = await getDealer(req.auth!.userId);
  const car = await getOwnedCar(parsed.data.carId, dealer.id);
  if (["SOLD", "ARCHIVED"].includes(car.status)) throw new HttpError(409, "This vehicle has already been sold or archived.", "CAR_NOT_SELLABLE");
  const existing = await VehicleSale.findOne({ dealerId: dealer.id, carId: car.id });
  if (existing) throw new HttpError(409, "A sale has already been recorded for this vehicle.", "SALE_ALREADY_RECORDED");
  const expenseRows = await VehicleExpense.find({ dealerId: dealer.id, carId: car.id }).select("amount").lean();
  const expensesTotal = expenseRows.reduce((sum: number, item: any) => sum + Number(item.amount || 0), 0);
  const soldAt = new Date();
  const profit = parsed.data.salePrice - parsed.data.acquisitionCost - expensesTotal;
  const sale = await VehicleSale.create({ dealerId: dealer.id, carId: car.id, salePrice: parsed.data.salePrice, acquisitionCost: parsed.data.acquisitionCost, expensesTotal, profit, soldAt });
  car.status = "SOLD";
  car.soldAt = soldAt;
  await car.save();
  res.status(201).json({ success: true, data: { id: sale.id, carId: car.id, title: car.title, carTitle: car.title, price: sale.salePrice, salePrice: sale.salePrice, cost: sale.acquisitionCost, acquisitionCost: sale.acquisitionCost, expenses: sale.expensesTotal, profit: sale.profit, date: sale.soldAt, soldAt: sale.soldAt }, message: "Sale recorded and vehicle marked as sold." });
}));
