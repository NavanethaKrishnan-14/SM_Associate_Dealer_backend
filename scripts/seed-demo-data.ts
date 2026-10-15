import "dotenv/config";
import bcrypt from "bcryptjs";
import {
  connectMongo,
  disconnectMongo,
  User,
  Dealer,
  Brand,
  CarModel,
  Car,
  Favorite,
  Enquiry,
  TestDrive,
  Notification,
  CarReport,
  VehicleExpense,
  VehicleSale,
} from "../src/lib/mongo.js";

const DEMO_PASSWORD = "Demo@12345!A";

async function getOrCreate<T extends { _id: unknown }>(
  model: any,
  filter: Record<string, unknown>,
  values: Record<string, unknown>,
): Promise<any> {
  const existing = await model.findOne(filter);
  if (existing) return existing;
  return model.create(values);
}

async function main() {
  await connectMongo();
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const dealerUser1 = await getOrCreate(User, { email: "demo.dealer@smassociate.test" }, {
    name: "Demo Dealer Tirunelveli",
    email: "demo.dealer@smassociate.test",
    phone: "9000000101",
    passwordHash,
    role: "DEALER",
    status: "ACTIVE",
  });
  const dealerUser2 = await getOrCreate(User, { email: "demo.dealer2@smassociate.test" }, {
    name: "Demo Auto Gallery",
    email: "demo.dealer2@smassociate.test",
    phone: "9000000102",
    passwordHash,
    role: "DEALER",
    status: "ACTIVE",
  });
  const customer1 = await getOrCreate(User, { email: "demo.customer@smassociate.test" }, {
    name: "Demo Customer",
    email: "demo.customer@smassociate.test",
    phone: "9000000103",
    passwordHash,
    role: "CUSTOMER",
    status: "ACTIVE",
  });
  const customer2 = await getOrCreate(User, { email: "demo.customer2@smassociate.test" }, {
    name: "Demo Customer Two",
    email: "demo.customer2@smassociate.test",
    phone: "9000000104",
    passwordHash,
    role: "CUSTOMER",
    status: "ACTIVE",
  });

  const dealer1 = await getOrCreate(Dealer, { userId: dealerUser1.id }, {
    userId: dealerUser1.id,
    businessName: "SM Demo Motors",
    description: "Demo used-car dealer for marketplace testing.",
    addressLine: "Trivandrum Road",
    city: "Tirunelveli",
    state: "Tamil Nadu",
    postalCode: "627002",
    verificationStatus: "APPROVED",
    verifiedAt: new Date(),
  });
  const dealer2 = await getOrCreate(Dealer, { userId: dealerUser2.id }, {
    userId: dealerUser2.id,
    businessName: "Demo Auto Gallery",
    description: "Sample multi-brand pre-owned car showroom.",
    addressLine: "Madurai Road",
    city: "Tirunelveli",
    state: "Tamil Nadu",
    postalCode: "627011",
    verificationStatus: "APPROVED",
    verifiedAt: new Date(),
  });

  const catalogue = [
    { name: "Maruti Suzuki", slug: "maruti-suzuki", models: [
      { name: "Swift", slug: "swift" },
      { name: "Dzire", slug: "dzire" },
      { name: "Baleno", slug: "baleno" },
    ] },
    { name: "Hyundai", slug: "hyundai", models: [
      { name: "i20", slug: "i20" },
      { name: "Creta", slug: "creta" },
    ] },
    { name: "Tata", slug: "tata", models: [
      { name: "Nexon", slug: "nexon" },
    ] },
    { name: "Honda", slug: "honda", models: [
      { name: "City", slug: "city" },
    ] },
  ];

  const modelByName = new Map<string, { brandId: string; modelId: string }>();
  for (const item of catalogue) {
    const brand = await getOrCreate(Brand, { slug: item.slug }, { name: item.name, slug: item.slug });
    for (const modelInfo of item.models) {
      const model = await getOrCreate(CarModel, { brandId: brand.id, slug: modelInfo.slug }, {
        brandId: brand.id,
        name: modelInfo.name,
        slug: modelInfo.slug,
      });
      modelByName.set(modelInfo.name, { brandId: brand.id, modelId: model.id });
    }
  }

  const carSpecs = [
    { key: "swift-vxi-2022", dealer: dealer1, model: "Swift", title: "2022 Maruti Suzuki Swift VXi", priceInr: 625000, year: 2022, km: 28500, fuel: "PETROL", transmission: "MANUAL", color: "Pearl Arctic White", ownership: 1, status: "AVAILABLE" },
    { key: "dzire-vxi-2024", dealer: dealer1, model: "Dzire", title: "2024 Maruti Suzuki Dzire VXi", priceInr: 735000, year: 2024, km: 7600, fuel: "PETROL", transmission: "MANUAL", color: "Bluish Black", ownership: 1, status: "AVAILABLE" },
    { key: "baleno-zeta-2021", dealer: dealer2, model: "Baleno", title: "2021 Maruti Suzuki Baleno Zeta", priceInr: 685000, year: 2021, km: 41000, fuel: "PETROL", transmission: "AUTOMATIC", color: "Nexa Blue", ownership: 1, status: "AVAILABLE" },
    { key: "creta-sx-2023", dealer: dealer2, model: "Creta", title: "2023 Hyundai Creta SX", priceInr: 1425000, year: 2023, km: 19500, fuel: "DIESEL", transmission: "AUTOMATIC", color: "Titan Grey", ownership: 1, status: "AVAILABLE" },
    { key: "city-vx-2020-sold", dealer: dealer1, model: "City", title: "2020 Honda City VX (Demo Sold)", priceInr: 825000, year: 2020, km: 52000, fuel: "PETROL", transmission: "MANUAL", color: "Modern Steel Metallic", ownership: 2, status: "SOLD" },
    { key: "nexon-xz-2022", dealer: dealer2, model: "Nexon", title: "2022 Tata Nexon XZ+", priceInr: 890000, year: 2022, km: 33500, fuel: "PETROL", transmission: "MANUAL", color: "Daytona Grey", ownership: 1, status: "PENDING_APPROVAL" },
    { key: "i20-sportz-2021-draft", dealer: dealer1, model: "i20", title: "2021 Hyundai i20 Sportz (Draft)", priceInr: 710000, year: 2021, km: 38000, fuel: "PETROL", transmission: "MANUAL", color: "Fiery Red", ownership: 1, status: "DRAFT" },
  ];

  const carsByKey = new Map<string, any>();
  for (const spec of carSpecs) {
    const refs = modelByName.get(spec.model);
    if (!refs) throw new Error(`Missing catalogue model: ${spec.model}`);
    const car = await getOrCreate(Car, { title: spec.title, dealerId: spec.dealer.id }, {
      dealerId: spec.dealer.id,
      brandId: refs.brandId,
      modelId: refs.modelId,
      title: spec.title,
      variant: spec.title.split(" ").slice(-1)[0],
      description: `Demo listing for SM Associate Cars marketplace testing. ${spec.year} model, inspected sample vehicle in Tirunelveli.`,
      priceInr: spec.priceInr,
      manufacturingYear: spec.year,
      registrationYear: spec.year,
      mileageKm: spec.km,
      fuelType: spec.fuel,
      transmission: spec.transmission,
      bodyType: spec.model === "Creta" || spec.model === "Nexon" ? "SUV" : "HATCHBACK",
      color: spec.color,
      ownershipCount: spec.ownership,
      registrationState: "TN",
      city: "Tirunelveli",
      state: "Tamil Nadu",
      status: spec.status,
      ...(spec.status === "AVAILABLE" ? { publishedAt: new Date() } : {}),
      ...(spec.status === "SOLD" ? { soldAt: new Date() } : {}),
    });
    carsByKey.set(spec.key, car);
  }

  const swift = carsByKey.get("swift-vxi-2022");
  const dzire = carsByKey.get("dzire-vxi-2024");
  const soldCity = carsByKey.get("city-vx-2020-sold");
  const now = Date.now();

  await getOrCreate(Favorite, { userId: customer1.id, carId: swift.id }, { userId: customer1.id, carId: swift.id });
  await getOrCreate(Favorite, { userId: customer2.id, carId: dzire.id }, { userId: customer2.id, carId: dzire.id });
  await getOrCreate(Enquiry, { customerId: customer1.id, carId: dzire.id, message: "Demo enquiry: is the vehicle available for inspection?" }, {
    customerId: customer1.id, contactName: customer1.name, contactPhone: customer1.phone,
    dealerId: dealer1.id, carId: dzire.id, message: "Demo enquiry: is the vehicle available for inspection?",
    enquiryType: "CAR_ENQUIRY", status: "NEW",
  });
  await getOrCreate(Enquiry, { customerId: customer2.id, carId: swift.id, message: "Demo enquiry: can I arrange a test drive?" }, {
    customerId: customer2.id, contactName: customer2.name, contactPhone: customer2.phone,
    dealerId: dealer1.id, carId: swift.id, message: "Demo enquiry: can I arrange a test drive?",
    enquiryType: "CAR_ENQUIRY", status: "CONTACTED", contactedAt: new Date(),
  });
  await getOrCreate(TestDrive, { customerId: customer1.id, carId: swift.id }, {
    customerId: customer1.id, carId: swift.id, dealerId: dealer1.id,
    scheduledAt: new Date(now + 3 * 24 * 60 * 60 * 1000), status: "REQUESTED",
    notes: "Demo test-drive booking. Please confirm the time with the customer.",
  });
  await getOrCreate(Notification, { userId: customer1.id, title: "Welcome to SM Associate Cars" }, {
    userId: customer1.id, title: "Welcome to SM Associate Cars",
    body: "Your demo customer account is ready. Explore available cars and save your favourites.",
    data: { demo: true },
  });
  await getOrCreate(Notification, { userId: dealerUser1.id, title: "New demo enquiry received" }, {
    userId: dealerUser1.id, title: "New demo enquiry received",
    body: "A customer has enquired about the 2024 Maruti Suzuki Dzire VXi.",
    data: { carId: dzire.id, demo: true },
  });
  await getOrCreate(CarReport, { reporterId: customer2.id, carId: dzire.id, reason: "DEMO_REVIEW" }, {
    reporterId: customer2.id, carId: dzire.id, reason: "DEMO_REVIEW",
    details: "Sample moderation report for testing the Admin dashboard.",
    status: "OPEN",
  });
  await getOrCreate(VehicleExpense, { dealerId: dealer1.id, carId: swift.id, category: "SERVICE" }, {
    dealerId: dealer1.id, carId: swift.id, category: "SERVICE", amount: 4500,
    note: "Demo periodic service expense.",
  });
  await getOrCreate(VehicleExpense, { dealerId: dealer1.id, carId: soldCity.id, category: "DETAILING" }, {
    dealerId: dealer1.id, carId: soldCity.id, category: "DETAILING", amount: 3500,
    note: "Demo detailing expense before sale.",
  });
  await getOrCreate(VehicleSale, { carId: soldCity.id }, {
    dealerId: dealer1.id, carId: soldCity.id, salePrice: 825000,
    acquisitionCost: 735000, expensesTotal: 3500, profit: 86500,
    soldAt: new Date(),
  });

  console.log("Demo marketplace data is ready (existing records were preserved).");
  console.log("Demo sign-in accounts (password shared by all):");
  console.log("  Dealer:   demo.dealer@smassociate.test");
  console.log("  Dealer 2: demo.dealer2@smassociate.test");
  console.log("  Customer: demo.customer@smassociate.test");
  console.log("  Customer 2: demo.customer2@smassociate.test");
  console.log(`  Password: ${DEMO_PASSWORD}`);
  console.log("Use only in a development/test database. Change or remove these accounts before production.");
}

main()
  .catch((error: unknown) => {
    console.error("Demo data seed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectMongo();
  });
