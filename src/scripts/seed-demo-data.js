// Updated seed script for three demo datasets with relationship integrity
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import { connectDatabase } from "../config/database.js";
import { Dataset, DatasetField, DatasetRecord } from "../models/index.js";
import { faker } from "@faker-js/faker";

// Default configuration – can be overridden via CLI flags
const DEFAULT_RECORD_COUNT = 100_000;
const DEFAULT_BATCH_SIZE = 5_000;

// Deterministic faker seed for reproducibility
faker.seed(12345);

// Demo dataset definitions
const DEMO_DATASETS = [
  {
    slug: "customer-directory",
    name: "Customer Directory",
    description: "A realistic set of 100k customers for demo purposes.",
    category: "Business",
    fields: [
      ["firstName", "First Name", "string", true, true, true, true],
      ["lastName", "Last Name", "string", true, true, true, true],
      ["email", "Email", "email", true, true, true, true],
      ["phone", "Phone", "string", true, true, true, true],
      ["company", "Company", "string", true, true, true, true],
      ["industry", "Industry", "string", true, true, true, true],
      ["city", "City", "string", true, true, true, true],
      ["country", "Country", "string", true, true, true, true],
      ["registrationDate", "Registration Date", "date", true, true, true, true],
      ["status", "Status", "string", true, true, true, true],
    ],
    generator: (index) => {
      const seed = index + 1;
      faker.seed(seed);
      return {
        seedKey: `customer-${String(seed).padStart(6, "0")}`,
        data: {
          firstName: faker.person.firstName(),
          lastName: faker.person.lastName(),
          email: faker.internet.email(),
          phone: faker.phone.number("+1-###-###-####"),
          company: faker.company.name(),
          industry: faker.commerce.department(),
          city: faker.location.city(),
          country: faker.location.country(),
          registrationDate: faker.date.between({ from: "2015-01-01", to: "2022-12-31" }),
          status: faker.helpers.arrayElement(["active", "prospect", "under_review", "inactive"]),
        },
      };
    },
  },
  {
    slug: "product-inventory",
    name: "Product Inventory",
    description: "A realistic product catalog for demo purposes.",
    category: "Business",
    fields: [
      ["sku", "SKU", "string", true, true, true, true],
      ["name", "Product Name", "string", true, true, true, true],
      ["category", "Category", "string", true, true, true, true],
      ["description", "Description", "string", false, true, false, true],
      ["price", "Price", "currency", true, true, true, true],
      ["stockQuantity", "Stock Quantity", "number", true, true, true, true],
      ["supplier", "Supplier", "string", true, true, true, true],
      ["status", "Status", "string", true, true, true, true],
      ["createdAt", "Created At", "date", true, true, true, true],
    ],
    generator: (index) => {
      const seed = index + 1;
      faker.seed(seed + 1000000);
      const sku = `SKU-${String(seed).padStart(6, "0")}`;
      const price = parseFloat(faker.commerce.price(5, 500, 2));
      return {
        seedKey: `product-${String(seed).padStart(6, "0")}`,
        data: {
          sku,
          name: faker.commerce.productName(),
          category: faker.commerce.department(),
          description: faker.commerce.productDescription(),
          price,
          stockQuantity: faker.number.int({ min: 0, max: 1000 }),
          supplier: faker.company.name(),
          status: faker.helpers.arrayElement(["available", "discontinued", "backorder"]),
          createdAt: faker.date.past({ years: 3 }),
        },
      };
    },
  },
  {
    slug: "sales-transactions",
    name: "Sales Transactions",
    description: "Synthetic sales transactions linking customers and products.",
    category: "Business",
    fields: [
      ["orderId", "Order ID", "string", true, true, true, true],
      ["customerId", "Customer ID", "string", true, true, true, true],
      ["productId", "Product ID", "string", true, true, true, true],
      ["quantity", "Quantity", "number", true, true, true, true],
      ["unitPrice", "Unit Price", "currency", true, true, true, true],
      ["totalPrice", "Total Price", "currency", true, true, true, true],
      ["paymentMethod", "Payment Method", "string", true, true, true, true],
      ["transactionDate", "Transaction Date", "date", true, true, true, true],
      ["status", "Status", "string", true, true, true, true],
    ],
    generator: (index, customerMap, productMap) => {
      const seed = index + 1;
      faker.seed(seed + 2000000);
      const customerKeys = Array.from(customerMap.keys());
      const productKeys = Array.from(productMap.keys());
      const custKey = customerKeys[seed % customerKeys.length];
      const prodKey = productKeys[seed % productKeys.length];
      const customerId = customerMap.get(custKey);
      const productId = productMap.get(prodKey);
      const quantity = faker.number.int({ min: 1, max: 20 });
      const unitPrice = parseFloat(faker.commerce.price(5, 500, 2));
      return {
        seedKey: `sale-${String(seed).padStart(6, "0")}`,
        data: {
          orderId: `ORD-${String(seed).padStart(8, "0")}`,
          customerId: customerId?.toString() ?? null,
          productId: productId?.toString() ?? null,
          quantity,
          unitPrice,
          totalPrice: parseFloat((quantity * unitPrice).toFixed(2)),
          paymentMethod: faker.helpers.arrayElement(["credit_card", "paypal", "bank_transfer", "cash"]),
          transactionDate: faker.date.between({ from: "2020-01-01", to: "2023-12-31" }),
          status: faker.helpers.arrayElement(["completed", "pending", "refunded", "failed"]),
        },
      };
    },
  },
];

/** Helper: upsert a dataset and its fields */
async function ensureDataset(def, creatorId) {
  const dataset = await Dataset.findOneAndUpdate(
    { slug: def.slug },
    {
      $set: {
        name: def.name,
        description: def.description,
        category: def.category,
        dataSource: { name: "DataScope Demo Generator", type: "synthetic", description: "Demo data" },
        creatorId,
      },
      $setOnInsert: { slug: def.slug },
    },
    { upsert: true, returnDocument: "after", runValidators: true },
  );

  await DatasetField.bulkWrite(
    def.fields.map(([name, label, dataType, searchable, filterable, sortable, visible]) => ({
      updateOne: {
        filter: { datasetId: dataset._id, name },
        update: { $set: { label, dataType, searchable, filterable, sortable, visibleByDefault: visible }, $setOnInsert: { datasetId: dataset._id, name } },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  return dataset;
}

/** Helper: bulk‑insert records for a dataset, returning a map seedKey→_id */
async function seedRecords(dataset, count, batchSize, generator, extraMaps = null) {
  const existing = new Set(
    await DatasetRecord.collection.distinct("seedKey", { datasetId: dataset._id, seedKey: { $type: "string" } })
  );
  let inserted = 0;
  const idMap = new Map();
  for (let start = 0; start < count; start += batchSize) {
    const batchEnd = Math.min(start + batchSize, count);
    const docs = [];
    for (let i = start; i < batchEnd; i++) {
      const rec = extraMaps ? generator(i, ...extraMaps) : generator(i);
      if (!existing.has(rec.seedKey)) {
        docs.push({ datasetId: dataset._id, seedKey: rec.seedKey, data: rec.data });
      }
    }
    if (docs.length) {
      const res = await DatasetRecord.insertMany(docs, { ordered: false });
      inserted += res.length;
      for (let i = 0; i < res.length; i++) {
        idMap.set(docs[i].seedKey, res[i]._id);
      }
    }
  }
  const allRecords = await DatasetRecord.find({ datasetId: dataset._id, seedKey: { $regex: `^${dataset.slug}` } }, { seedKey: 1, _id: 1 });
  for (const r of allRecords) {
    idMap.set(r.seedKey, r._id);
  }
  return { inserted, idMap };
}

/** Main seeding workflow */
async function seedDemo({ recordCount = DEFAULT_RECORD_COUNT, batchSize = DEFAULT_BATCH_SIZE, reset = false, quiet = false, creatorEmail }) {
  if (!creatorEmail) throw new Error("creatorEmail is required");
  const db = await connectDatabase(process.env.MONGODB_URI);
  const creator = await db.collection("user").findOne({ email: creatorEmail }, { projection: { _id: 1 } });
  if (!creator) throw new Error(`No Better‑Auth user found for ${creatorEmail}`);

  if (reset) {
    for (const def of DEMO_DATASETS) {
      const ds = await Dataset.findOne({ slug: def.slug });
      if (ds) {
        const delResult = await DatasetRecord.deleteMany({ datasetId: ds._id, seedKey: { $regex: `^${def.slug}` } });
        if (!quiet) console.log(`Reset ${delResult.deletedCount} records from ${def.slug}`);
      }
    }
  }

  const datasets = {};
  for (const def of DEMO_DATASETS) {
    const ds = await ensureDataset(def, creator._id.toString());
    datasets[def.slug] = ds;
    if (!quiet) console.log(`Dataset ${def.name} (${def.slug}) ready – id ${ds._id}`);
  }

  const customerDef = DEMO_DATASETS.find((d) => d.slug === "customer-directory");
  const productDef = DEMO_DATASETS.find((d) => d.slug === "product-inventory");
  const customerResult = await seedRecords(datasets[customerDef.slug], recordCount, batchSize, customerDef.generator);
  const productResult = await seedRecords(datasets[productDef.slug], recordCount, batchSize, productDef.generator);
  if (!quiet) {
    console.log(`Customers inserted: ${customerResult.inserted}`);
    console.log(`Products inserted: ${productResult.inserted}`);
  }
  const customerMap = customerResult.idMap;
  const productMap = productResult.idMap;

  const salesDef = DEMO_DATASETS.find((d) => d.slug === "sales-transactions");
  const salesResult = await seedRecords(
    datasets[salesDef.slug],
    recordCount,
    batchSize,
    salesDef.generator,
    [customerMap, productMap]
  );
  if (!quiet) console.log(`Sales inserted: ${salesResult.inserted}`);

  for (const def of DEMO_DATASETS) {
    const cnt = await DatasetRecord.countDocuments({ datasetId: datasets[def.slug]._id });
    await Dataset.updateOne({ _id: datasets[def.slug]._id }, { $set: { totalRecords: cnt } });
    if (!quiet) console.log(`Dataset ${def.slug} now has ${cnt} records.`);
  }

  await mongoose.disconnect();
  return { inserted: { customers: customerResult.inserted, products: productResult.inserted, sales: salesResult.inserted } };
}

// CLI handling
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const recordCount = parseInt(args[args.indexOf("--size") + 1] || DEFAULT_RECORD_COUNT, 10);
  const batchSize = parseInt(args[args.indexOf("--batch") + 1] || DEFAULT_BATCH_SIZE, 10);
  const reset = args.includes("--reset");
  const quiet = args.includes("--quiet");
  const emailIdx = args.indexOf("--creator-email");
  const creatorEmail = emailIdx >= 0 ? args[emailIdx + 1] : "";
  if (!creatorEmail) {
    console.error("Usage: npm run seed:demo -- --creator-email <admin@email> [--size N] [--batch B] [--reset] [--quiet]");
    process.exit(1);
  }
  seedDemo({ recordCount, batchSize, reset, quiet, creatorEmail })
    .then((res) => console.log("Seeding completed", res))
    .catch((e) => { console.error("Seeding error", e); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
}
