import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import { createServer } from "node:http";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { ROLES } from "../src/authorization/permissions.js";
import { createDatasetRouter } from "../src/authorization/dataset-routes.js";
import { initializeDataModels } from "../src/models/index.js";
import { Dataset } from "../src/models/dataset.js";
import { DatasetAccessPermission } from "../src/models/dataset-access-permission.js";
import { DatasetField } from "../src/models/dataset-field.js";
import { DatasetRecord } from "../src/models/dataset-record.js";
import { RecordHistory } from "../src/models/record-history.js";
import { RecordRelationship } from "../src/models/record-relationship.js";
import { SavedView } from "../src/models/saved-view.js";
import { SearchHistory } from "../src/models/search-history.js";
import { UserPreference } from "../src/models/user-preference.js";
import { seedSyntheticBusinessData } from "../src/scripts/seed-demo-data.js";

let mongo;

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri("datascope-model-tests"));
  await initializeDataModels();
});

after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

test("all data models are registered with the intended collections and references", () => {
  assert.equal(Dataset.collection.collectionName, "datasets");
  assert.equal(DatasetField.collection.collectionName, "datasetFields");
  assert.equal(DatasetRecord.collection.collectionName, "records");
  assert.equal(RecordRelationship.collection.collectionName, "recordRelationships");
  assert.equal(RecordHistory.collection.collectionName, "recordHistory");
  assert.equal(SavedView.collection.collectionName, "savedViews");
  assert.equal(SearchHistory.collection.collectionName, "searchHistory");
  assert.equal(UserPreference.collection.collectionName, "userPreferences");
  assert.equal(DatasetAccessPermission.collection.collectionName, "datasetPermissions");
  assert.ok(DatasetRecord.schema.path("datasetId"));
  assert.ok(DatasetRecord.schema.path("data"));
  assert.equal(Dataset.schema.virtuals.accessPermissions.options.ref, "DatasetAccessPermission");
  assert.equal(Dataset.schema.path("creatorId").instance, "String");

  const testDataset = new Dataset({
    name: "String Creator Test",
    slug: "string-creator-test",
    category: "General",
    dataSource: { name: "Manual", type: "custom" },
    creatorId: "better-auth-user-id-string-12345",
  });
  assert.equal(testDataset.creatorId, "better-auth-user-id-string-12345");

  const savedViewIndexes = SavedView.schema.indexes().map(([fields]) => Object.keys(fields).join(","));
  assert.ok(savedViewIndexes.includes("ownerId,datasetId,updatedAt"));
  assert.ok(savedViewIndexes.includes("sharedWith,datasetId,updatedAt"));
  assert.ok(savedViewIndexes.includes("datasetId,updatedAt"));
  assert.ok(!savedViewIndexes.some((idx) => idx.includes("isShared")));
});

test("synthetic business seed creates 100,000 records and is idempotent", async () => {
  const creatorId = new mongoose.Types.ObjectId();
  const seeded = await seedSyntheticBusinessData(creatorId);

  assert.equal(seeded.insertedCount, 100_000);
  assert.equal(seeded.totalRecords, 100_000);
  assert.equal(await DatasetRecord.countDocuments({ datasetId: seeded.dataset._id }), 100_000);
  assert.equal(
    (await Dataset.findById(seeded.dataset._id)).totalRecords,
    100_000,
  );
  assert.equal(
    await DatasetField.countDocuments({ datasetId: seeded.dataset._id }),
    12,
  );

  const variedIndustries = await DatasetRecord.distinct("data.industry", {
    datasetId: seeded.dataset._id,
  });
  const variedCountries = await DatasetRecord.distinct("data.country", {
    datasetId: seeded.dataset._id,
  });
  const variedStatuses = await DatasetRecord.distinct("data.status", {
    datasetId: seeded.dataset._id,
  });
  assert.ok(variedIndustries.length >= 10);
  assert.ok(variedCountries.length >= 10);
  assert.ok(variedStatuses.length >= 4);

  const combinedFilter = {
    datasetId: seeded.dataset._id,
    $and: [
      { "data.status": "active" },
      { "data.country": "France" },
      { "data.revenue": { $gt: 10_000 } },
      {
        "data.createdDate": {
          $gte: new Date("2018-01-01T00:00:00.000Z"),
          $lte: new Date("2027-01-01T00:00:00.000Z"),
        },
      },
    ],
  };
  const combinedCount = await DatasetRecord.countDocuments(combinedFilter);
  const combinedPage = await DatasetRecord.find(combinedFilter).limit(25).lean();
  assert.ok(combinedCount > 0 && combinedCount < 100_000);
  assert.equal(combinedPage.length, Math.min(25, combinedCount));
  assert.ok(combinedPage.every((record) =>
    record.data.status === "active" &&
    record.data.country === "France" &&
    record.data.revenue > 10_000 &&
    record.data.createdDate >= new Date("2018-01-01T00:00:00.000Z") &&
    record.data.createdDate <= new Date("2027-01-01T00:00:00.000Z"),
  ));

  const app = express();
  const testAuth = {
    api: {
      getSession: async () => ({
        user: { id: creatorId.toString(), role: ROLES.ADMINISTRATOR },
      }),
    },
  };
  app.use("/api/datasets", createDatasetRouter(testAuth, mongoose.connection.db));
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const filters = [
      { field: "status", operator: "equals", value: "active" },
      { field: "country", operator: "equals", value: "France" },
      { field: "revenue", operator: "greaterThan", value: "10000" },
      {
        field: "createdDate",
        operator: "between",
        value: "2018-01-01",
        valueTo: "2027-01-01",
      },
    ];
    const params = new URLSearchParams({
      filters: JSON.stringify(filters),
      page: "1",
      pageSize: "25",
    });
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/datasets/${seeded.dataset._id}/records?${params}`,
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.totalMatchingRecords, combinedCount);
    assert.equal(result.records.length, Math.min(25, combinedCount));
    assert.ok(result.records.every((record) =>
      record.data.status === "active" &&
      record.data.country === "France" &&
      record.data.revenue > 10_000,
    ));
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  const rerun = await seedSyntheticBusinessData(creatorId);
  assert.equal(rerun.insertedCount, 0);
  assert.equal(rerun.totalRecords, 100_000);
});
