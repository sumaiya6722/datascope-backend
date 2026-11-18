import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import { connectDatabase } from "../config/database.js";
import {
  Dataset,
  DatasetAccessPermission,
  DatasetField,
  DatasetRecord,
} from "../models/index.js";

const DEFAULT_RECORD_COUNT = 100_000;
const DEFAULT_BATCH_SIZE = 2_000;
const MAX_RECORD_COUNT = 1_000_000;

const industries = [
  "Technology", "Manufacturing", "Healthcare", "Finance", "Retail",
  "Logistics", "Energy", "Education", "Telecommunications", "Agriculture",
  "Professional Services", "Hospitality",
];
const countries = [
  "France", "Germany", "United States", "Canada", "Japan", "Australia",
  "Brazil", "India", "United Kingdom", "Spain", "Netherlands", "Singapore",
];
const categories = ["Enterprise", "Mid-market", "Small business", "Public sector"];
const statuses = ["active", "prospect", "under_review", "inactive"];

const fieldDefinitions = [
  ["companyName", "Company Name", "string", true, true, true, true],
  ["industry", "Industry", "string", true, true, true, true],
  ["country", "Country", "string", true, true, true, true],
  ["category", "Category", "string", true, true, true, true],
  ["status", "Status", "string", true, true, true, true],
  ["revenue", "Revenue", "currency", false, true, true, true],
  ["employees", "Employees", "number", false, true, true, true],
  ["contact", "Primary Contact", "object", true, true, false, true],
  ["createdDate", "Created Date", "date", false, true, true, true],
  ["city", "City", "string", true, true, true, true],
  ["accountManager", "Account Manager", "string", true, true, true, false],
  ["source", "Data Source", "string", true, true, false, false],
];

const datasetDefinition = {
  name: "Business Directory",
  slug: "business-directory",
  description: "A deterministic synthetic business directory for DataScope demos and performance evaluation.",
  category: "Business",
  dataSource: {
    name: "DataScope Demo Generator",
    type: "synthetic",
    description: "Deterministic fictional records generated locally.",
  },
};

function makeRecord(index) {
  const number = index + 1;
  const country = countries[number % countries.length];
  const date = new Date(Date.UTC(2018 + (number % 9), number % 12, 1 + (number % 27)));
  const revenue = 1_000 + ((number * 7_919) % 99_000);

  return {
    seedKey: `business-${String(number).padStart(7, "0")}`,
    data: {
      companyName: `Company ${String(number).padStart(7, "0")}`,
      industry: industries[(number * 7) % industries.length],
      country,
      category: categories[(number * 3) % categories.length],
      status: statuses[number % statuses.length],
      revenue,
      employees: 5 + ((number * 37) % 49_995),
      contact: {
        name: `Contact ${number}`,
        email: `contact${number}@example.test`,
        title: "Business Contact",
      },
      createdDate: date,
      city: `City ${(number * 13) % 500}`,
      accountManager: `Manager ${(number * 11) % 250}`,
      source: ["CRM", "ERP", "Partner Import", "Manual Entry"][number % 4],
    },
  };
}

function validateSeedOptions(recordCount, batchSize) {
  if (!Number.isSafeInteger(recordCount) || recordCount < 1 || recordCount > MAX_RECORD_COUNT) {
    throw new Error(`recordCount must be an integer between 1 and ${MAX_RECORD_COUNT}.`);
  }
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
    throw new Error("batchSize must be an integer between 1 and 10,000.");
  }
}

/** Add any missing deterministic demo records without deleting existing data. */
export async function seedSyntheticBusinessData(
  creatorId,
  { recordCount = DEFAULT_RECORD_COUNT, batchSize = DEFAULT_BATCH_SIZE } = {},
) {
  validateSeedOptions(recordCount, batchSize);
  if (!creatorId) throw new Error("creatorId is required.");
  const ownerId = creatorId.toString();

  await Promise.all([
    Dataset.init(),
    DatasetAccessPermission.init(),
    DatasetField.init(),
    DatasetRecord.init(),
  ]);

  const dataset = await Dataset.findOneAndUpdate(
    { slug: datasetDefinition.slug },
    {
      $set: {
        ...datasetDefinition,
        creatorId: ownerId,
      },
    },
    { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true },
  );

  await DatasetField.bulkWrite(
    fieldDefinitions.map(([name, label, dataType, searchable, filterable, sortable, visibleByDefault]) => ({
      updateOne: {
        filter: { datasetId: dataset._id, name },
        update: {
          $set: { label, dataType, searchable, filterable, sortable, visibleByDefault },
          $setOnInsert: { datasetId: dataset._id, name },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  let insertedCount = 0;
  for (let start = 0; start < recordCount; start += batchSize) {
    const end = Math.min(start + batchSize, recordCount);
    const operations = [];
    for (let index = start; index < end; index += 1) {
      const record = makeRecord(index);
      operations.push({
        updateOne: {
          filter: { datasetId: dataset._id, seedKey: record.seedKey },
          update: { $setOnInsert: { datasetId: dataset._id, ...record } },
          upsert: true,
        },
      });
    }
    if (operations.length) {
      const result = await DatasetRecord.bulkWrite(operations, { ordered: false });
      insertedCount += result.upsertedCount;
    }
  }

  const totalRecords = await DatasetRecord.countDocuments({ datasetId: dataset._id });
  await Dataset.updateOne({ _id: dataset._id }, { $set: { totalRecords } });

  const viewers = await mongoose.connection.db
    .collection("user")
    .find({ role: "viewer" }, { projection: { _id: 1 } })
    .toArray();
  if (viewers.length) {
    await DatasetAccessPermission.bulkWrite(
      viewers.map((viewer) => ({
        updateOne: {
          filter: { datasetId: dataset._id, userId: viewer._id.toString() },
          update: {
            $addToSet: { permissions: "read" },
            $setOnInsert: { grantedBy: null },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  return { dataset, insertedCount, totalRecords };
}

async function runCli() {
  const args = process.argv.slice(2);
  const sizeIndex = args.indexOf("--size");
  const batchIndex = args.indexOf("--batch");
  const emailIndex = args.indexOf("--creator-email");
  const recordCount = sizeIndex >= 0 ? Number(args[sizeIndex + 1]) : DEFAULT_RECORD_COUNT;
  const batchSize = batchIndex >= 0 ? Number(args[batchIndex + 1]) : DEFAULT_BATCH_SIZE;
  const creatorEmail = emailIndex >= 0 ? args[emailIndex + 1]?.trim() : "";

  if (!creatorEmail) {
    throw new Error("Usage: npm run seed:demo -- --creator-email <registered-email> [--size N] [--batch N]");
  }
  validateSeedOptions(recordCount, batchSize);

  const database = await connectDatabase(process.env.MONGODB_URI);
  const user = await database.collection("user").findOne(
    { email: creatorEmail },
    { projection: { _id: 1 } },
  );
  if (!user) throw new Error("No registered user matches --creator-email.");

  const result = await seedSyntheticBusinessData(user._id, { recordCount, batchSize });
  console.log(JSON.stringify({
    datasetId: result.dataset._id.toString(),
    insertedCount: result.insertedCount,
    totalRecords: result.totalRecords,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli()
    .catch((error) => {
      console.error(`Seeding failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
