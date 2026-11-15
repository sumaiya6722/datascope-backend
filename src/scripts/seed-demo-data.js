import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import { connectDatabase } from "../config/database.js";
import { Dataset, DatasetField, DatasetRecord } from "../models/index.js";

const RECORD_COUNT = 100_000;
const BATCH_SIZE = 1_000;
const DATASET_SLUG = "synthetic-business-demo";
const SYNTHETIC_DATA_SOURCE = {
  name: "DataScope Synthetic Business Generator",
  type: "synthetic",
  description: "Deterministic fictional business data for product demonstrations.",
};

const companyPrefixes = [
  "Apex", "Bright", "Cedar", "Cobalt", "Crest", "Evergreen", "First", "Golden",
  "Harbor", "Horizon", "Keystone", "Meridian", "Northstar", "Oakline", "Pioneer",
  "Redwood", "Silver", "Summit", "Trident", "Waypoint",
];
const companyNouns = [
  "Analytics", "Commerce", "Dynamics", "Enterprises", "Group", "Industries",
  "Innovations", "Logistics", "Partners", "Systems", "Technologies", "Solutions",
];
const industries = [
  "Technology", "Healthcare", "Manufacturing", "Financial Services", "Retail",
  "Energy", "Transportation", "Education", "Telecommunications", "Agriculture",
  "Construction", "Professional Services",
];
const countries = [
  { name: "United States", code: "US", currency: "USD" },
  { name: "Canada", code: "CA", currency: "CAD" },
  { name: "United Kingdom", code: "GB", currency: "GBP" },
  { name: "Germany", code: "DE", currency: "EUR" },
  { name: "France", code: "FR", currency: "EUR" },
  { name: "Australia", code: "AU", currency: "AUD" },
  { name: "Japan", code: "JP", currency: "JPY" },
  { name: "Singapore", code: "SG", currency: "SGD" },
  { name: "India", code: "IN", currency: "INR" },
  { name: "Brazil", code: "BR", currency: "BRL" },
  { name: "Netherlands", code: "NL", currency: "EUR" },
  { name: "Sweden", code: "SE", currency: "SEK" },
];
const contactFirstNames = [
  "Alex", "Avery", "Casey", "Jordan", "Morgan", "Riley", "Sam", "Taylor",
  "Cameron", "Jamie", "Quinn", "Robin",
];
const contactLastNames = [
  "Bennett", "Chen", "Diaz", "Foster", "Khan", "Kim", "Morgan", "Patel",
  "Reed", "Singh", "Turner", "Wong",
];
const statuses = ["active", "prospect", "under_review", "inactive"];
const categories = ["Enterprise", "Mid-Market", "Small Business", "Public Sector"];

function valueAt(values, seed, multiplier = 1) {
  return values[Math.floor((seed * multiplier) % values.length)];
}

function makeRecord(index, now) {
  const seed = index + 1;
  const country = valueAt(countries, seed, 7);
  const firstName = valueAt(contactFirstNames, seed, 11);
  const lastName = valueAt(contactLastNames, seed, 13);
  const createdAt = new Date(Date.UTC(2018, 0, 1) + (seed * 7_919_137) % 252_460_800_000);
  const updatedAt = new Date(
    Math.min(now.getTime(), createdAt.getTime() + ((seed * 1_299_709) % 2_592_000_000)),
  );
  const annualRevenue = 50_000 + ((seed * 104_729) % 49_950_001);
  const employeeCount = 5 + ((seed * 3_571) % 19_996);

  return {
    seedKey: `demo-${String(seed).padStart(6, "0")}`,
    createdAt,
    updatedAt,
    data: {
      companyName: `${valueAt(companyPrefixes, seed, 17)} ${valueAt(companyNouns, seed, 19)} ${String(1000 + seed)}`,
      industry: valueAt(industries, seed, 23),
      country: country.name,
      countryCode: country.code,
      revenue: annualRevenue,
      currency: country.currency,
      employeeCount,
      status: valueAt(statuses, seed, 29),
      createdDate: createdAt,
      updatedDate: updatedAt,
      contact: {
        name: `${firstName} ${lastName}`,
        title: valueAt(["Director", "Operations Lead", "Finance Manager", "Chief Executive", "Data Manager"], seed, 31),
        email: `contact-${seed}@company-${seed}.example`,
        phone: `+1-202-555-${String(1000 + (seed % 9000)).padStart(4, "0")}`,
      },
      category: valueAt(categories, seed, 37),
    },
  };
}

function parseCreatorEmail(args) {
  const emailIndex = args.indexOf("--creator-email");
  return emailIndex >= 0 ? args[emailIndex + 1]?.trim().toLowerCase() : "";
}

export async function seedSyntheticBusinessData(creatorId, count = RECORD_COUNT) {
  if (!Number.isInteger(count) || count < RECORD_COUNT) {
    throw new Error(`The demo seed must contain at least ${RECORD_COUNT} records.`);
  }

  const normalizedCreatorId = creatorId?.toString();
  if (!normalizedCreatorId) {
    throw new Error("A creator ID is required to seed synthetic business data.");
  }
  const now = new Date();
  const dataset = await Dataset.findOneAndUpdate(
    { slug: DATASET_SLUG },
    {
      $set: {
        name: "Synthetic Business Directory",
        description: "A varied, fictional company directory for demonstrating DataScope discovery, search, filters, and analysis.",
        category: "Business",
        dataSource: SYNTHETIC_DATA_SOURCE,
        creatorId: normalizedCreatorId,
      },
      $setOnInsert: { slug: DATASET_SLUG },
    },
    { upsert: true, returnDocument: "after", runValidators: true },
  );

  const fieldDefinitions = [
    ["companyName", "Company name", "string", true, true, true, true],
    ["industry", "Industry", "string", true, true, true, true],
    ["country", "Country", "string", true, true, true, true],
    ["countryCode", "Country code", "string", true, true, true, false],
    ["revenue", "Annual revenue", "currency", false, true, true, true],
    ["currency", "Revenue currency", "string", false, true, true, false],
    ["employeeCount", "Employee count", "number", false, true, true, true],
    ["status", "Status", "string", true, true, true, true],
    ["createdDate", "Created date", "date", false, true, true, true],
    ["updatedDate", "Updated date", "date", false, true, true, false],
    ["contact", "Contact information", "object", true, false, false, true],
    ["category", "Category", "string", true, true, true, true],
  ];

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

  await DatasetRecord.init();
  const existingSeedKeys = new Set(
    await DatasetRecord.collection.distinct("seedKey", {
      datasetId: dataset._id,
      seedKey: { $type: "string" },
    }),
  );
  let insertedCount = 0;
  for (let start = 0; start < count; start += BATCH_SIZE) {
    const batchEnd = Math.min(start + BATCH_SIZE, count);
    const records = [];

    for (let index = start; index < batchEnd; index += 1) {
      const record = makeRecord(index, now);
      if (!existingSeedKeys.has(record.seedKey)) {
        records.push({
          datasetId: dataset._id,
          seedKey: record.seedKey,
          data: record.data,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        });
      }
    }

    if (records.length) {
      const inserted = await DatasetRecord.insertMany(records, { ordered: false });
      insertedCount += inserted.length;
    }
  }

  const totalRecords = await DatasetRecord.countDocuments({ datasetId: dataset._id });
  if (totalRecords < RECORD_COUNT) {
    throw new Error(`Seed verification failed: found ${totalRecords} records; expected at least ${RECORD_COUNT}.`);
  }

  await Dataset.updateOne({ _id: dataset._id }, { $set: { totalRecords } });
  return { dataset, insertedCount, totalRecords };
}

async function main() {
  const creatorEmail = parseCreatorEmail(process.argv.slice(2));
  if (!creatorEmail) {
    throw new Error("Provide an existing Better Auth account with --creator-email user@example.com.");
  }

  const database = await connectDatabase(process.env.MONGODB_URI);
  const creator = await database.collection("user").findOne(
    { email: { $regex: `^${creatorEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } },
    { projection: { _id: 1 } },
  );
  if (!creator) {
    throw new Error("No registered Better Auth user matches --creator-email.");
  }

  const result = await seedSyntheticBusinessData(creator._id);
  console.log(`Inserted ${result.insertedCount} synthetic business records.`);
  console.log(`Verified ${result.totalRecords} records in dataset "${result.dataset.name}".`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error("Could not seed DataScope demo data:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
