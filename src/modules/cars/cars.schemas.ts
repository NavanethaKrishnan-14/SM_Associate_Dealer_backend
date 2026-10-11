import { z } from "zod";

const optionalNumber = (min: number, max: number) =>
  z.coerce.number().finite().min(min).max(max).optional();

export const listCarsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  city: z.string().trim().max(100).optional(),
  brand: z.string().trim().max(100).optional(),
  model: z.string().trim().max(100).optional(),
  fuelType: z.enum(["PETROL", "DIESEL", "CNG", "ELECTRIC", "HYBRID"]).optional(),
  transmission: z.enum(["MANUAL", "AUTOMATIC"]).optional(),
  minPrice: optionalNumber(0, 1_000_000_000),
  maxPrice: optionalNumber(0, 1_000_000_000),
  minYear: optionalNumber(1950, 2100),
  maxYear: optionalNumber(1950, 2100),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  sort: z.enum(["newest", "price_asc", "price_desc", "year_desc", "mileage_asc"]).default("newest"),
}).refine((v) => v.minPrice === undefined || v.maxPrice === undefined || v.minPrice <= v.maxPrice, {
  message: "minPrice must be less than or equal to maxPrice",
  path: ["minPrice"],
}).refine((v) => v.minYear === undefined || v.maxYear === undefined || v.minYear <= v.maxYear, {
  message: "minYear must be less than or equal to maxYear",
  path: ["minYear"],
});

export type ListCarsQuery = z.infer<typeof listCarsQuerySchema>;
