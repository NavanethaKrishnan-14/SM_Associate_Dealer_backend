import mongoose, { type Model } from "mongoose";
import {
  connectMongo, disconnectMongo,
  User, Dealer, Brand, CarModel, Car, CarImage, Favorite, Enquiry,
  TestDrive, Notification, CarReport, RefreshToken, AuditLog,
} from "../src/lib/mongo.js";

type Doc = Record<string, any> & { _id: any };
type Plan = {
  name: string;
  model: Model<any>;
  prefix: (doc: Doc) => string;
  docs: Doc[];
  idMap: Map<string, string>;
};

const apply = process.argv.includes("--apply");
const isPrefixedId = /^[A-Z]{3,4}-\d{3,}$/;
const formatId = (prefix: string, n: number) => `${prefix}-${String(n).padStart(3, "0")}`;
const plans: Plan[] = [
  { name: "users", model: User, prefix: d => d.role === "DEALER" ? "DLR" : ["ADMIN", "SUPER_ADMIN"].includes(d.role) ? "ADM" : "CUS", docs: [], idMap: new Map() },
  { name: "dealers", model: Dealer, prefix: () => "DLP", docs: [], idMap: new Map() },
  { name: "brands", model: Brand, prefix: () => "BRD", docs: [], idMap: new Map() },
  { name: "models", model: CarModel, prefix: () => "MOD", docs: [], idMap: new Map() },
  { name: "cars", model: Car, prefix: () => "CAR", docs: [], idMap: new Map() },
  { name: "images", model: CarImage, prefix: () => "IMG", docs: [], idMap: new Map() },
  { name: "favorites", model: Favorite, prefix: () => "FAV", docs: [], idMap: new Map() },
  { name: "enquiries", model: Enquiry, prefix: () => "ENQ", docs: [], idMap: new Map() },
  { name: "testDrives", model: TestDrive, prefix: () => "TDR", docs: [], idMap: new Map() },
  { name: "notifications", model: Notification, prefix: () => "NOT", docs: [], idMap: new Map() },
  { name: "reports", model: CarReport, prefix: () => "RPT", docs: [], idMap: new Map() },
  { name: "refreshTokens", model: RefreshToken, prefix: () => "RFT", docs: [], idMap: new Map() },
  { name: "auditLogs", model: AuditLog, prefix: () => "AUD", docs: [], idMap: new Map() },
];

const stringKey = (value: unknown): string | undefined =>
  value === undefined || value === null ? undefined : String(value);

function mapId(collection: string, value: unknown): any {
  const k = stringKey(value);
  if (!k) return value;
  return plans.find(p => p.name === collection)?.idMap.get(k) ?? value;
}

function rewriteReferences(collection: string, source: Doc): Doc {
  const d: Doc = { ...source };
  if (collection === "dealers") d.userId = mapId("users", d.userId);
  if (collection === "cars") {
    d.dealerId = mapId("dealers", d.dealerId);
    d.brandId = mapId("brands", d.brandId);
    d.modelId = mapId("models", d.modelId);
  }
  if (collection === "images") d.carId = mapId("cars", d.carId);
  if (collection === "favorites") {
    d.userId = mapId("users", d.userId);
    d.carId = mapId("cars", d.carId);
  }
  if (collection === "enquiries") {
    d.carId = mapId("cars", d.carId);
    d.customerId = mapId("users", d.customerId);
    d.dealerId = mapId("dealers", d.dealerId);
  }
  if (collection === "testDrives") {
    d.carId = mapId("cars", d.carId);
    d.customerId = mapId("users", d.customerId);
    d.dealerId = mapId("dealers", d.dealerId);
  }
  if (collection === "notifications") {
    d.userId = mapId("users", d.userId);
    if (d.data && typeof d.data === "object" && !Array.isArray(d.data)) {
      d.data = { ...d.data };
      if (d.data.carId != null) d.data.carId = mapId("cars", d.data.carId);
      if (d.data.enquiryId != null) d.data.enquiryId = mapId("enquiries", d.data.enquiryId);
      if (d.data.testDriveId != null) d.data.testDriveId = mapId("testDrives", d.data.testDriveId);
    }
  }
  if (collection === "reports") {
    d.carId = mapId("cars", d.carId);
    d.reporterId = mapId("users", d.reporterId);
  }
  if (collection === "refreshTokens") d.userId = mapId("users", d.userId);
  if (collection === "auditLogs") {
    d.actorId = mapId("users", d.actorId);
    const entityCollection: Record<string, string> = {
      User: "users", Dealer: "dealers", Brand: "brands", CarModel: "models",
      Car: "cars", CarImage: "images", Favorite: "favorites", Enquiry: "enquiries",
      TestDrive: "testDrives", Notification: "notifications", CarReport: "reports",
      RefreshToken: "refreshTokens", AuditLog: "auditLogs",
    };
    if (d.entityType && entityCollection[d.entityType]) {
      d.entityId = mapId(entityCollection[d.entityType], d.entityId);
    }
  }
  return d;
}

async function main() {
  await connectMongo();
  const session = await mongoose.startSession();
  try {
    for (const plan of plans) {
      plan.docs = await plan.model.collection.find({}).toArray() as Doc[];
    }

    // Build the complete ID map before changing any documents. Existing prefixed IDs
    // are preserved, and new sequence values begin above both existing IDs and counters.
    for (const plan of plans) {
      const prefixes = new Set<string>();
      for (const doc of plan.docs) {
        const id = String(doc._id);
        prefixes.add(isPrefixedId.test(id) ? id.split("-")[0] : plan.prefix(doc));
      }
      for (const prefix of prefixes) {
        const maxExistingId = plan.docs.reduce((max, doc) => {
          const id = String(doc._id);
          return id.startsWith(prefix + "-") && isPrefixedId.test(id)
            ? Math.max(max, Number(id.slice(prefix.length + 1)))
            : max;
        }, 0);
        const counter = await mongoose.connection.collection("id_counters").findOne({ _id: prefix });
        let seq = Math.max(maxExistingId, Number(counter?.seq ?? 0));
        for (const doc of plan.docs) {
          const oldId = String(doc._id);
          if (isPrefixedId.test(oldId) || plan.prefix(doc) !== prefix) continue;
          seq += 1;
          plan.idMap.set(oldId, formatId(prefix, seq));
        }
      }
    }

    const summary = plans.map(p => ({
      collection: p.model.collection.name,
      total: p.docs.length,
      idsToChange: p.idMap.size,
      examples: [...p.idMap.entries()].slice(0, 3).map(([from, to]) => ({ from, to })),
    }));
    console.log(JSON.stringify({ mode: apply ? "APPLY" : "DRY RUN", summary }, null, 2));
    if (!apply) {
      console.log("Dry run only: no database documents or counters were changed. Review this mapping before using --apply.");
      return;
    }

    await session.withTransaction(async () => {
      // Reserve counter values inside the same transaction as the migration.
      for (const plan of plans) {
        const prefixes = new Set([...plan.idMap.values()].map(id => id.split("-")[0]));
        for (const prefix of prefixes) {
          const maxAssigned = [...plan.idMap.values()].reduce((max, id) =>
            id.startsWith(prefix + "-") ? Math.max(max, Number(id.slice(prefix.length + 1))) : max, 0);
          await mongoose.connection.collection("id_counters").updateOne(
            { _id: prefix }, { $max: { seq: maxAssigned } }, { upsert: true, session },
          );
        }
      }

      // Remove only old-ID documents first, within the transaction, to avoid unique
      // index collisions when inserting their replacements. Transaction rollback protects data.
      for (const plan of plans) {
        const oldIds = plan.docs.filter(doc => plan.idMap.has(String(doc._id))).map(doc => doc._id);
        if (oldIds.length) await plan.model.collection.deleteMany({ _id: { $in: oldIds } }, { session });
      }

      // Insert migrated documents with preserved fields/timestamps and rewritten references.
      for (const plan of plans) {
        const migrated = plan.docs.filter(doc => plan.idMap.has(String(doc._id))).map(doc => {
          const rewritten = rewriteReferences(plan.name, doc);
          rewritten._id = plan.idMap.get(String(doc._id));
          return rewritten;
        });
        if (migrated.length) await plan.model.collection.insertMany(migrated, { session, ordered: true });
      }

      // Existing prefixed records can still point at records that were just migrated.
      for (const plan of plans) {
        for (const doc of plan.docs.filter(item => !plan.idMap.has(String(item._id)))) {
          const rewritten = rewriteReferences(plan.name, doc);
          const { _id, ...fields } = rewritten;
          if (JSON.stringify(doc) !== JSON.stringify(rewritten)) {
            await plan.model.collection.updateOne({ _id }, { $set: fields }, { session });
          }
        }
      }
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });

    console.log("Migration committed. Check collection counts and test login, listings, favourites, enquiries, and test drives.");
  } finally {
    await session.endSession();
    await disconnectMongo();
  }
}

main().catch(async error => {
  console.error("ID migration failed. If --apply was used, the transaction should roll back on supported replica-set deployments.", error);
  await disconnectMongo().catch(() => undefined);
  process.exitCode = 1;
});
