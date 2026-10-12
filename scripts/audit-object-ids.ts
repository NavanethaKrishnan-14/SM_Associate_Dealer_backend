import mongoose from "mongoose";
import { connectMongo, disconnectMongo } from "../src/lib/mongo.js";

function isObjectId(value: unknown): boolean {
  return value instanceof mongoose.Types.ObjectId ||
    (!!value && typeof value === "object" && (value as any)._bsontype === "ObjectId");
}

function collectObjectIdPaths(value: unknown, path = "", output = new Set<string>()): Set<string> {
  if (isObjectId(value)) {
    output.add(path || "<root>");
    return output;
  }
  if (!value || typeof value !== "object" || value instanceof Date || Buffer.isBuffer(value)) return output;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectObjectIdPaths(item, `${path}[${index}]`, output));
    return output;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    collectObjectIdPaths(item, path ? `${path}.${key}` : key, output);
  }
  return output;
}

async function main() {
  await connectMongo();
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB connection is not ready.");

  const results: Array<{
    collection: string;
    documents: number;
    objectIdPrimaryKeys: number;
    objectIdFields: Record<string, number>;
    samples: Array<{ _id: string; paths: string[] }>;
  }> = [];

  for (const info of await db.listCollections({}, { nameOnly: true }).toArray()) {
    if (info.name.startsWith("system.")) continue;
    const collection = db.collection(info.name);
    const docs = await collection.find({}).toArray();
    let objectIdPrimaryKeys = 0;
    const objectIdFields: Record<string, number> = {};
    const samples: Array<{ _id: string; paths: string[] }> = [];

    for (const doc of docs) {
      if (isObjectId(doc._id)) objectIdPrimaryKeys++;
      const paths = [...collectObjectIdPaths(doc)];
      if (paths.length) {
        for (const path of paths) objectIdFields[path] = (objectIdFields[path] ?? 0) + 1;
        if (samples.length < 5) samples.push({ _id: String(doc._id), paths });
      }
    }
    if (objectIdPrimaryKeys || Object.keys(objectIdFields).length) {
      results.push({ collection: info.name, documents: docs.length, objectIdPrimaryKeys, objectIdFields, samples });
    }
  }

  console.log(JSON.stringify({
    status: results.length ? "OBJECT_IDS_FOUND" : "NO_OBJECT_IDS_FOUND",
    collectionsScanned: (await db.listCollections({}, { nameOnly: true }).toArray()).length,
    collectionsWithObjectIds: results,
    note: "Audit only: this script never changes data. Use the report to identify collections/references before migrating anything outside the known schema."
  }, null, 2));
}

main().catch(error => {
  console.error("ObjectId audit failed:", error);
  process.exitCode = 1;
}).finally(async () => {
  await disconnectMongo().catch(() => undefined);
});
