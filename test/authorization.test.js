import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ObjectId } from "mongodb";
import mongoose from "mongoose";
import { createApp } from "../src/app.js";
import {
  initializeDatasetPermissionIndexes,
} from "../src/authorization/dataset-routes.js";
import { initializeFirstAdministrator } from "../src/authorization/initialize-first-admin.js";
import { hasPermission, ROLES } from "../src/authorization/permissions.js";
import { createAuth } from "../src/auth.js";
import { DatasetRecord } from "../src/models/dataset-record.js";

const frontendUrl = "http://localhost:3000";
const secret = "test-only-authorization-secret-with-at-least-32-characters";
const password = "authorization-test-password";
const cookieJars = new Map();
let database;
let mongo;
let server;
let baseURL;
let users;
let datasets;

function updateCookieJar(jar, response) {
  for (const cookie of response.headers.getSetCookie()) {
    const [cookiePair, ...attributes] = cookie.split(";");
    const separator = cookiePair.indexOf("=");
    const name = cookiePair.slice(0, separator);
    const value = cookiePair.slice(separator + 1);
    const isExpired = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));

    if (isExpired || !value) {
      jar.delete(name);
    } else {
      jar.set(name, value);
    }
  }
}

async function request(path, { body, cookieJar, headers = {}, method = "GET" } = {}) {
  const requestHeaders = { origin: frontendUrl, ...headers };
  if (body !== undefined) {
    requestHeaders["content-type"] = "application/json";
  }
  if (cookieJar?.size) {
    requestHeaders.cookie = [...cookieJar.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  const response = await fetch(`${baseURL}${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (cookieJar) {
    updateCookieJar(cookieJar, response);
  }

  return {
    response,
    body:
      response.status === 204
        ? null
        : response.headers.get("content-type")?.includes("application/json")
          ? await response.json()
          : await response.text(),
  };
}

async function register(email, name) {
  const cookieJar = new Map();
  const result = await request("/api/auth/sign-up/email", {
    cookieJar,
    method: "POST",
    body: { name, email, password },
  });

  assert.equal(result.response.status, 200);
  cookieJars.set(email, cookieJar);
  return result.body.user;
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri("datascope-authorization-tests"));
  database = mongoose.connection.db;
  await initializeDatasetPermissionIndexes(database);
  await DatasetRecord.init();

  const auth = createAuth(database, {
    baseURL: "http://localhost:4000",
    frontendUrl,
    secret,
    isProduction: false,
  });
  server = createApp(frontendUrl, auth, database).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseURL = `http://localhost:${server.address().port}`;

  users = {
    administrator: await register("administrator@datascope.test", "Initial Administrator"),
    analyst: await register("analyst@datascope.test", "Data Analyst"),
    viewer: await register("viewer@datascope.test", "Dataset Viewer"),
  };

  await initializeFirstAdministrator(database, users.administrator.email);
  await assert.rejects(
    initializeFirstAdministrator(database, users.analyst.email),
    /claimed by another account/,
  );
  assert.equal(
    (await database.collection("user").findOne({ _id: new ObjectId(users.administrator.id) })).role,
    ROLES.ADMINISTRATOR,
  );

  await database.collection("user").updateOne(
    { _id: new ObjectId(users.analyst.id) },
    { $set: { role: ROLES.DATA_ANALYST } },
  );

  datasets = {
    shared: new ObjectId(),
    viewerOnly: new ObjectId(),
  };
  await database.collection("datasets").insertMany([
    { _id: datasets.shared, name: "Shared dataset", description: "Analyst export enabled" },
    { _id: datasets.viewerOnly, name: "Viewer dataset", description: "Read access" },
  ]);
  await database.collection("records").insertMany([
    { _id: new ObjectId(), datasetId: datasets.shared, data: { value: "shared-record" } },
    {
      _id: new ObjectId(),
      datasetId: datasets.shared,
      data: {
        value: "Apex Active",
        companyName: "Apex Analytics Germany",
        status: "active",
        country: "Germany",
        revenue: 12000,
        createdDate: new Date("2024-05-10T00:00:00.000Z"),
        isPublic: true,
      },
    },
    {
      _id: new ObjectId(),
      datasetId: datasets.shared,
      data: {
        value: "Apex Low Revenue",
        companyName: "Apex Systems Germany",
        status: "active",
        country: "Germany",
        revenue: 9000,
        createdDate: new Date("2024-06-10T00:00:00.000Z"),
        isPublic: false,
      },
    },
    {
      _id: new ObjectId(),
      datasetId: datasets.shared,
      data: {
        value: "Apex Prospect",
        companyName: "Apex Commerce Germany",
        status: "prospect",
        country: "Germany",
        revenue: 16000,
        createdDate: new Date("2024-06-10T00:00:00.000Z"),
        isPublic: true,
      },
    },
    { _id: new ObjectId(), datasetId: datasets.viewerOnly, data: { value: "viewer-record" } },
  ]);
  await database.collection("datasetFields").insertMany([
    {
      datasetId: datasets.shared,
      name: "value",
      label: "Value",
      dataType: "string",
      searchable: true,
      filterable: true,
      sortable: true,
      visibleByDefault: true,
    },
    ...[
      ["companyName", "Company name", "string", true, true],
      ["industry", "Industry", "string", false, true],
      ["country", "Country", "string", true, true],
      ["category", "Category", "string", false, true],
      ["contact", "Contact", "object", false, true],
      ["status", "Status", "string", true, true],
      ["revenue", "Revenue", "currency", true, false],
      ["createdDate", "Created date", "date", true, false],
      ["isPublic", "Public", "boolean", true, false],
    ].map(([name, label, dataType, filterable, searchable]) => ({
      datasetId: datasets.shared,
      name,
      label,
      dataType,
      searchable,
      filterable,
      sortable: true,
      visibleByDefault: true,
    })),
    {
      datasetId: datasets.viewerOnly,
      name: "value",
      label: "Value",
      dataType: "string",
      searchable: true,
      filterable: false,
      sortable: true,
      visibleByDefault: true,
    },
  ]);
  await database.collection("datasetPermissions").insertMany([
    {
      datasetId: datasets.shared,
      userId: users.analyst.id,
      permissions: ["read", "export"],
    },
    {
      datasetId: datasets.viewerOnly,
      userId: users.viewer.id,
      permissions: ["read"],
    },
  ]);
});

after(async () => {
  if (server?.listening) {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  await mongoose.disconnect();
  await mongo?.stop();
});

test("the three roles receive only their declared capabilities", () => {
  assert.equal(hasPermission(ROLES.ADMINISTRATOR, "user:manage"), true);
  assert.equal(hasPermission(ROLES.ADMINISTRATOR, "system:manage"), true);
  assert.equal(hasPermission(ROLES.DATA_ANALYST, "dataset:search:advanced"), true);
  assert.equal(hasPermission(ROLES.DATA_ANALYST, "dataset:export"), true);
  assert.equal(hasPermission(ROLES.DATA_ANALYST, "user:manage"), false);
  assert.equal(hasPermission(ROLES.VIEWER, "dataset:search:basic"), true);
  assert.equal(hasPermission(ROLES.VIEWER, "dataset:filters:multiple"), false);
  assert.equal(hasPermission(ROLES.VIEWER, "dataset:export"), false);
  assert.equal(hasPermission("unknown-role", "dataset:read"), false);
});

test("first Administrator initialization can retry only for its originally claimed account", async () => {
  const retryDatabase = database.client.db("datascope-bootstrap-retry");
  const selectedUserId = new ObjectId();
  const otherUserId = new ObjectId();

  try {
    await retryDatabase.collection("user").insertMany([
      { _id: selectedUserId, email: "retry-admin@datascope.test", role: ROLES.VIEWER },
      { _id: otherUserId, email: "other-admin@datascope.test", role: ROLES.VIEWER },
    ]);
    await retryDatabase.collection("authorizationBootstrap").insertOne({
      _id: "first-administrator",
      userId: selectedUserId.toString(),
      createdAt: new Date(),
    });

    const initialized = await initializeFirstAdministrator(
      retryDatabase,
      "retry-admin@datascope.test",
    );
    assert.equal(initialized.id, selectedUserId.toString());
    assert.equal(
      (await retryDatabase.collection("user").findOne({ _id: selectedUserId })).role,
      ROLES.ADMINISTRATOR,
    );
    await assert.rejects(
      initializeFirstAdministrator(retryDatabase, "other-admin@datascope.test"),
      /claimed by another account/,
    );
  } finally {
    await retryDatabase.dropDatabase();
  }
});

test("API access is server-authenticated, role-checked, and dataset-scoped", async () => {
  const adminCookie = cookieJars.get(users.administrator.email);
  const analystCookie = cookieJars.get(users.analyst.email);
  const viewerCookie = cookieJars.get(users.viewer.email);
  const anonymousDatasets = await request("/api/datasets");
  assert.equal(anonymousDatasets.response.status, 401);

  const adminDatasets = await request("/api/datasets", { cookieJar: adminCookie });
  assert.equal(adminDatasets.response.status, 200);
  assert.equal(adminDatasets.body.datasets.length, 2);

  const analystDatasets = await request("/api/datasets?userId=attacker", {
    cookieJar: analystCookie,
    headers: { "x-user-id": users.administrator.id },
  });
  assert.equal(analystDatasets.response.status, 200);
  assert.deepEqual(analystDatasets.body.datasets.map((dataset) => dataset.id), [
    datasets.shared.toString(),
  ]);

  const viewerDatasets = await request("/api/datasets", { cookieJar: viewerCookie });
  assert.equal(viewerDatasets.response.status, 200);
  assert.deepEqual(viewerDatasets.body.datasets.map((dataset) => dataset.id), [
    datasets.viewerOnly.toString(),
  ]);

  const viewerRecords = await request(`/api/datasets/${datasets.viewerOnly}/records`, {
    cookieJar: viewerCookie,
    headers: { "x-user-id": users.administrator.id },
  });
  assert.equal(viewerRecords.response.status, 200);
  assert.equal(viewerRecords.body.records[0].data.value, "viewer-record");

  const manipulatedDataset = await request(`/api/datasets/${datasets.shared}/records?userId=${users.administrator.id}`, {
    cookieJar: viewerCookie,
    headers: { "x-user-id": users.administrator.id },
  });
  assert.equal(manipulatedDataset.response.status, 403);

  const analystExport = await request(`/api/datasets/${datasets.shared}/export`, {
    cookieJar: analystCookie,
  });
  assert.equal(analystExport.response.status, 200);
  assert.equal(analystExport.body.records[0].data.value, "shared-record");

  const recordId = analystExport.body.records[0]._id ?? analystExport.body.records[0].id;
  const analystCsvSelected = await request(`/api/datasets/${datasets.shared}/export/csv`, {
    method: "POST",
    cookieJar: analystCookie,
    body: {
      mode: "selected",
      fields: ["value", "companyName"],
      recordIds: [recordId],
    },
  });
  assert.equal(analystCsvSelected.response.status, 200);
  assert.ok(analystCsvSelected.response.headers.get("content-type")?.includes("text/csv"));
  assert.ok(analystCsvSelected.body.includes('"Value","Company name"'));

  const analystCsvFiltered = await request(`/api/datasets/${datasets.shared}/export/csv`, {
    method: "POST",
    cookieJar: analystCookie,
    body: {
      mode: "filtered",
      fields: ["value", "status"],
      filters: [{ field: "status", operator: "equals", value: "active" }],
    },
  });
  assert.equal(analystCsvFiltered.response.status, 200);
  assert.ok(analystCsvFiltered.response.headers.get("content-type")?.includes("text/csv"));

  const viewerExport = await request(`/api/datasets/${datasets.viewerOnly}/export`, {
    cookieJar: viewerCookie,
  });
  assert.equal(viewerExport.response.status, 403);

  const viewerCsvExport = await request(`/api/datasets/${datasets.viewerOnly}/export/csv`, {
    method: "POST",
    cookieJar: viewerCookie,
    body: {
      mode: "selected",
      fields: ["value"],
      recordIds: [recordId],
    },
  });
  assert.equal(viewerCsvExport.response.status, 403);

  const analystAdminData = await request("/api/admin/analytics", { cookieJar: analystCookie });
  assert.equal(analystAdminData.response.status, 403);
  const viewerAdminData = await request("/api/admin/users", { cookieJar: viewerCookie });
  assert.equal(viewerAdminData.response.status, 403);

  const adminAnalytics = await request("/api/admin/analytics", { cookieJar: adminCookie });
  assert.equal(adminAnalytics.response.status, 200);
  assert.equal(adminAnalytics.body.datasets, 2);
  const adminUsers = await request("/api/admin/users", { cookieJar: adminCookie });
  assert.equal(adminUsers.response.status, 200);
  assert.equal("password" in adminUsers.body.users[0], false);

  const unauthorizedRoleChange = await request(`/api/admin/users/${users.viewer.id}/role`, {
    cookieJar: viewerCookie,
    method: "PATCH",
    body: { role: ROLES.ADMINISTRATOR },
  });
  assert.equal(unauthorizedRoleChange.response.status, 403);
  const publicAdminRoleChange = await request(`/api/admin/users/${users.viewer.id}/role`, {
    cookieJar: adminCookie,
    method: "PATCH",
    body: { role: ROLES.ADMINISTRATOR },
  });
  assert.equal(publicAdminRoleChange.response.status, 400);
  assert.equal(
    (await database.collection("user").findOne({ _id: new ObjectId(users.viewer.id) })).role,
    ROLES.VIEWER,
  );

  const roleChange = await request(`/api/admin/users/${users.viewer.id}/role`, {
    cookieJar: adminCookie,
    method: "PATCH",
    body: { role: ROLES.DATA_ANALYST },
  });
  assert.equal(roleChange.response.status, 200);
  assert.equal(roleChange.body.role, ROLES.DATA_ANALYST);

  const grant = await request(
    `/api/admin/datasets/${datasets.shared}/permissions/${users.viewer.id}`,
    {
      cookieJar: adminCookie,
      method: "PUT",
      body: { permissions: ["read", "export"] },
    },
  );
  assert.equal(grant.response.status, 200);
  const newlyGrantedRecords = await request(`/api/datasets/${datasets.shared}/records`, {
    cookieJar: viewerCookie,
  });
  assert.equal(newlyGrantedRecords.response.status, 200);

  const analystGrantDenied = await request(
    `/api/admin/datasets/${datasets.shared}/permissions/${users.viewer.id}`,
    {
      cookieJar: analystCookie,
      method: "PUT",
      body: { permissions: ["read"] },
    },
  );
  assert.equal(analystGrantDenied.response.status, 403);

  const revoke = await request(
    `/api/admin/datasets/${datasets.shared}/permissions/${users.viewer.id}`,
    { cookieJar: adminCookie, method: "DELETE" },
  );
  assert.equal(revoke.response.status, 204);
  const revokedRecords = await request(`/api/datasets/${datasets.shared}/records`, {
    cookieJar: viewerCookie,
  });
  assert.equal(revokedRecords.response.status, 403);
  await database.collection("user").updateOne(
    { _id: new ObjectId(users.viewer.id) },
    { $set: { role: ROLES.VIEWER } },
  );
});

test("record searches validate filters and combine conditions with AND", async () => {
  const analystCookie = cookieJars.get(users.analyst.email);
  const filters = [
    { field: "status", operator: "equals", value: "active" },
    { field: "country", operator: "equals", value: "Germany" },
    { field: "revenue", operator: "greaterThan", value: "10000" },
    {
      field: "createdDate",
      operator: "between",
      value: "2024-01-01",
      valueTo: "2024-12-31",
    },
  ];
  const query = new URLSearchParams({
    filters: JSON.stringify(filters),
    q: "Apex",
    qMode: "partial",
  });
  const result = await request(`/api/datasets/${datasets.shared}/records?${query}`, {
    cookieJar: analystCookie,
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.body.totalMatchingRecords, 1);
  assert.equal(result.body.records[0].data.companyName, "Apex Analytics Germany");

  const exact = await request(
    `/api/datasets/${datasets.shared}/records?q=${encodeURIComponent("Apex Analytics Germany")}&qMode=exact`,
    { cookieJar: analystCookie },
  );
  assert.equal(exact.response.status, 200);
  assert.equal(exact.body.totalMatchingRecords, 1);

  const text = await request(
    `/api/datasets/${datasets.shared}/records?q=Apex&qMode=text&filters=${encodeURIComponent(JSON.stringify(filters.slice(0, 3)))}`,
    { cookieJar: analystCookie },
  );
  assert.equal(text.response.status, 200);
  assert.equal(text.body.totalMatchingRecords, 1);

  const countForFilter = async (condition) => {
    const filterQuery = new URLSearchParams({
      filters: JSON.stringify([condition]),
    });
    const filtered = await request(
      `/api/datasets/${datasets.shared}/records?${filterQuery}`,
      { cookieJar: analystCookie },
    );
    assert.equal(filtered.response.status, 200, filtered.body?.message);
    return filtered.body.totalMatchingRecords;
  };
  for (const [condition, expectedCount] of [
    [{ field: "status", operator: "notEquals", value: "prospect" }, 2],
    [{ field: "companyName", operator: "contains", value: "Apex" }, 3],
    [{ field: "companyName", operator: "notContains", value: "Systems" }, 2],
    [{ field: "companyName", operator: "startsWith", value: "Apex" }, 3],
    [{ field: "companyName", operator: "endsWith", value: "Germany" }, 3],
    [{ field: "revenue", operator: "equals", value: "12000" }, 1],
    [{ field: "revenue", operator: "notEquals", value: "12000" }, 2],
    [{ field: "revenue", operator: "lessThanOrEqual", value: "12000" }, 2],
    [{ field: "revenue", operator: "greaterThanOrEqual", value: "12000" }, 2],
    [{ field: "revenue", operator: "between", value: "9000", valueTo: "16000" }, 3],
    [{ field: "createdDate", operator: "before", value: "2024-06-01" }, 1],
    [{ field: "createdDate", operator: "after", value: "2024-06-01" }, 2],
    [{ field: "isPublic", operator: "isTrue" }, 2],
    [{ field: "isPublic", operator: "isFalse" }, 1],
  ]) {
    assert.equal(await countForFilter(condition), expectedCount, JSON.stringify(condition));
  }

  const invalidMongo = await request(
    `/api/datasets/${datasets.shared}/records?filters=${encodeURIComponent(JSON.stringify([{ field: "revenue", operator: "$where", value: "true" }]))}`,
    { cookieJar: analystCookie },
  );
  assert.equal(invalidMongo.response.status, 400);

  const invalidField = await request(
    `/api/datasets/${datasets.shared}/records?filters=${encodeURIComponent(JSON.stringify([{ field: "data.revenue", operator: "greaterThan", value: "10000" }]))}`,
    { cookieJar: analystCookie },
  );
  assert.equal(invalidField.response.status, 400);

  const unauthorizedFilter = await request(
    `/api/datasets/${datasets.shared}/records?filters=${encodeURIComponent(JSON.stringify(filters))}`,
    { cookieJar: cookieJars.get(users.viewer.email) },
  );
  assert.equal(unauthorizedFilter.response.status, 403);

  const viewerMultipleFilters = await request(
    `/api/datasets/${datasets.viewerOnly}/records?filters=${encodeURIComponent(JSON.stringify([
      { field: "value", operator: "equals", value: "viewer-record" },
      { field: "value", operator: "contains", value: "viewer" },
    ]))}`,
    { cookieJar: cookieJars.get(users.viewer.email) },
  );
  assert.equal(viewerMultipleFilters.response.status, 403);

  const viewerAdvancedSearch = await request(
    `/api/datasets/${datasets.viewerOnly}/records?q=viewer&qMode=exact`,
    { cookieJar: cookieJars.get(users.viewer.email) },
  );
  assert.equal(viewerAdvancedSearch.response.status, 403);
});

test("saved views and search history enforce ownership and dataset permissions", async () => {
  const analystCookie = cookieJars.get(users.analyst.email);
  const viewerCookie = cookieJars.get(users.viewer.email);
  const configuration = {
    datasetId: datasets.shared.toString(),
    name: "Active German companies",
    description: "A reusable demo search",
    query: "Apex",
    searchMode: "partial",
    filters: [
      { field: "status", operator: "equals", value: "active" },
      { field: "country", operator: "equals", value: "Germany" },
    ],
    sort: ["revenue:desc"],
    visibleFields: ["companyName", "revenue", "status"],
  };
  const privateView = await request("/api/saved-views", {
    cookieJar: analystCookie,
    method: "POST",
    body: configuration,
  });
  assert.equal(privateView.response.status, 201);
  assert.equal(privateView.body.view.ownerId, users.analyst.id);
  assert.deepEqual(privateView.body.view.sort, ["revenue:desc"]);

  const forgedOwner = await request("/api/saved-views", {
    cookieJar: analystCookie,
    method: "POST",
    body: { ...configuration, ownerId: users.administrator.id },
  });
  assert.equal(forgedOwner.response.status, 400);
  const viewerCannotCreateView = await request("/api/saved-views", {
    cookieJar: viewerCookie,
    method: "POST",
    body: configuration,
  });
  assert.equal(viewerCannotCreateView.response.status, 403);

  const analystViews = await request(`/api/saved-views?datasetId=${datasets.shared}`, {
    cookieJar: analystCookie,
  });
  assert.equal(analystViews.response.status, 200);
  assert.equal(analystViews.body.views.length, 1);

  const unauthorizedShare = await request(
    `/api/saved-views/${privateView.body.view.id}`,
    {
      cookieJar: analystCookie,
      method: "PATCH",
      body: {
        sharedWith: [users.viewer.id],
        filters: [configuration.filters[0]],
      },
    },
  );
  assert.equal(unauthorizedShare.response.status, 400);

  const viewerViewsBeforeGrant = await request(
    `/api/saved-views?datasetId=${datasets.shared}`,
    { cookieJar: viewerCookie },
  );
  assert.equal(viewerViewsBeforeGrant.response.status, 403);
  const viewerCannotReadDataset = await request(
    `/api/datasets/${datasets.shared}/records`,
    { cookieJar: viewerCookie },
  );
  assert.equal(viewerCannotReadDataset.response.status, 403);
  const viewerCannotForgeHistory = await request("/api/search-history", {
    cookieJar: viewerCookie,
    method: "POST",
    body: {
      datasetId: datasets.shared.toString(),
      query: "Apex",
      searchMode: "partial",
      filters: [],
      sort: [],
    },
  });
  assert.equal(viewerCannotForgeHistory.response.status, 403);

  await database.collection("datasetPermissions").insertOne({
    datasetId: datasets.shared,
    userId: users.viewer.id,
    permissions: ["read"],
  });
  const sharedViewUpdate = await request(`/api/saved-views/${privateView.body.view.id}`, {
    cookieJar: analystCookie,
    method: "PATCH",
    body: {
      sharedWith: [users.viewer.id],
      filters: [configuration.filters[0]],
    },
  });
  assert.equal(sharedViewUpdate.response.status, 200);
  assert.equal(sharedViewUpdate.body.view.isShared, true);

  const viewerSharedViews = await request(`/api/saved-views?datasetId=${datasets.shared}`, {
    cookieJar: viewerCookie,
  });
  assert.equal(viewerSharedViews.response.status, 200);
  assert.equal(viewerSharedViews.body.views.length, 1);
  assert.equal(viewerSharedViews.body.views[0].id, privateView.body.view.id);
  const viewerCannotEdit = await request(`/api/saved-views/${privateView.body.view.id}`, {
    cookieJar: viewerCookie,
    method: "PATCH",
    body: { name: "Hijacked view" },
  });
  assert.equal(viewerCannotEdit.response.status, 403);

  const historyCreate = await request("/api/search-history", {
    cookieJar: analystCookie,
    method: "POST",
    body: {
      datasetId: datasets.shared.toString(),
      query: "Apex",
      searchMode: "partial",
      filters: configuration.filters,
      sort: configuration.sort,
    },
  });
  assert.equal(historyCreate.response.status, 201);
  const historyList = await request(`/api/search-history?datasetId=${datasets.shared}`, {
    cookieJar: analystCookie,
  });
  assert.equal(historyList.response.status, 200);
  assert.equal(historyList.body.history.length, 1);
  assert.equal(historyList.body.history[0].description, "Apex");
  assert.deepEqual(historyList.body.history[0].filters, configuration.filters);

  const viewerOwnHistory = await request(`/api/search-history?datasetId=${datasets.shared}`, {
    cookieJar: viewerCookie,
  });
  assert.equal(viewerOwnHistory.response.status, 200);
  assert.deepEqual(viewerOwnHistory.body.history, []);

  await database.collection("datasetPermissions").deleteOne({
    datasetId: datasets.shared,
    userId: users.viewer.id,
  });
  const viewsAfterAccessRevoked = await request(`/api/saved-views?datasetId=${datasets.shared}`, {
    cookieJar: viewerCookie,
  });
  assert.equal(viewsAfterAccessRevoked.response.status, 403);
  const recordsAfterAccessRevoked = await request(`/api/datasets/${datasets.shared}/records`, {
    cookieJar: viewerCookie,
  });
  assert.equal(recordsAfterAccessRevoked.response.status, 403);

  const updated = await request(`/api/saved-views/${privateView.body.view.id}`, {
    cookieJar: analystCookie,
    method: "PATCH",
    body: { name: "Updated search", query: "Systems" },
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.view.name, "Updated search");

  const deleted = await request(`/api/saved-views/${privateView.body.view.id}`, {
    cookieJar: analystCookie,
    method: "DELETE",
  });
  assert.equal(deleted.response.status, 204);
});

test("dataset management is administrator-only and dataset reads follow grants", async () => {
  const adminCookie = cookieJars.get(users.administrator.email);
  const analystCookie = cookieJars.get(users.analyst.email);
  const viewerCookie = cookieJars.get(users.viewer.email);
  const payload = {
    name: "Managed Demo Dataset",
    slug: "managed-demo-dataset",
    description: "A dataset created through the management API.",
    category: "Business",
    dataSource: {
      name: "Synthetic API",
      type: "synthetic",
      description: "Test-only fictional source.",
    },
  };

  const anonymousCreate = await request("/api/datasets", { method: "POST", body: payload });
  assert.equal(anonymousCreate.response.status, 401);
  const viewerCreate = await request("/api/datasets", {
    cookieJar: viewerCookie,
    method: "POST",
    body: payload,
  });
  assert.equal(viewerCreate.response.status, 403);
  const analystCreate = await request("/api/datasets", {
    cookieJar: analystCookie,
    method: "POST",
    body: payload,
  });
  assert.equal(analystCreate.response.status, 403);

  const invalidCreate = await request("/api/datasets", {
    cookieJar: adminCookie,
    method: "POST",
    body: { ...payload, creatorId: users.viewer.id },
  });
  assert.equal(invalidCreate.response.status, 400);

  const created = await request("/api/datasets", {
    cookieJar: adminCookie,
    method: "POST",
    body: payload,
  });
  assert.equal(created.response.status, 201);
  const datasetId = created.body.dataset.id;
  assert.equal(created.body.dataset.totalRecords, 0);
  assert.equal(created.body.dataset.creatorId, users.administrator.id);

  const duplicateSlug = await request("/api/datasets", {
    cookieJar: adminCookie,
    method: "POST",
    body: payload,
  });
  assert.equal(duplicateSlug.response.status, 409);

  const hiddenFromViewer = await request(`/api/datasets/${datasetId}`, {
    cookieJar: viewerCookie,
  });
  assert.equal(hiddenFromViewer.response.status, 403);

  const unauthorizedUpdate = await request(`/api/datasets/${datasetId}`, {
    cookieJar: analystCookie,
    method: "PATCH",
    body: { name: "Attempted Analyst Edit" },
  });
  assert.equal(unauthorizedUpdate.response.status, 403);

  const invalidUpdate = await request(`/api/datasets/${datasetId}`, {
    cookieJar: adminCookie,
    method: "PATCH",
    body: { totalRecords: 99 },
  });
  assert.equal(invalidUpdate.response.status, 400);

  const updated = await request(`/api/datasets/${datasetId}`, {
    cookieJar: adminCookie,
    method: "PATCH",
    body: { name: "Managed Demo Dataset Updated" },
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.dataset.name, "Managed Demo Dataset Updated");
  assert.ok(updated.body.dataset.updatedAt);

  const invalidField = await request(`/api/datasets/${datasetId}/fields`, {
    cookieJar: adminCookie,
    method: "POST",
    body: { name: "1notAllowed", label: "Invalid", dataType: "string" },
  });
  assert.equal(invalidField.response.status, 400);
  const analystField = await request(`/api/datasets/${datasetId}/fields`, {
    cookieJar: analystCookie,
    method: "POST",
    body: { name: "companyName", label: "Company name", dataType: "string" },
  });
  assert.equal(analystField.response.status, 403);

  const field = await request(`/api/datasets/${datasetId}/fields`, {
    cookieJar: adminCookie,
    method: "POST",
    body: {
      name: "companyName",
      label: "Company name",
      dataType: "string",
      searchable: true,
      filterable: true,
      sortable: true,
      visibleByDefault: true,
    },
  });
  assert.equal(field.response.status, 201);
  const fieldId = field.body.field.id;
  const duplicateField = await request(`/api/datasets/${datasetId}/fields`, {
    cookieJar: adminCookie,
    method: "POST",
    body: { name: "companyName", label: "Duplicate", dataType: "string" },
  });
  assert.equal(duplicateField.response.status, 409);

  const fieldUpdate = await request(`/api/datasets/${datasetId}/fields/${fieldId}`, {
    cookieJar: adminCookie,
    method: "PATCH",
    body: { label: "Registered company", searchable: false },
  });
  assert.equal(fieldUpdate.response.status, 200);
  assert.equal(fieldUpdate.body.field.label, "Registered company");

  const deniedPermissionsList = await request(
    `/api/admin/datasets/${datasetId}/permissions`,
    { cookieJar: viewerCookie },
  );
  assert.equal(deniedPermissionsList.response.status, 403);

  const invalidGrant = await request(
    `/api/admin/datasets/${datasetId}/permissions/${users.viewer.id}`,
    {
      cookieJar: adminCookie,
      method: "PUT",
      body: { permissions: ["administrator"] },
    },
  );
  assert.equal(invalidGrant.response.status, 400);

  const grant = await request(
    `/api/admin/datasets/${datasetId}/permissions/${users.viewer.id}`,
    {
      cookieJar: adminCookie,
      method: "PUT",
      body: { permissions: ["read"] },
    },
  );
  assert.equal(grant.response.status, 200);
  const permissionList = await request(
    `/api/admin/datasets/${datasetId}/permissions`,
    { cookieJar: adminCookie },
  );
  assert.equal(permissionList.response.status, 200);
  assert.equal(permissionList.body.permissions[0].userId, users.viewer.id);

  const viewerCanRead = await request(`/api/datasets/${datasetId}`, {
    cookieJar: viewerCookie,
  });
  assert.equal(viewerCanRead.response.status, 200);

  const viewerFieldList = await request(`/api/datasets/${datasetId}/fields`, {
    cookieJar: viewerCookie,
  });
  assert.equal(viewerFieldList.response.status, 200);
  assert.equal(viewerFieldList.body.fields.length, 1);
  const viewerCannotEditField = await request(`/api/datasets/${datasetId}/fields/${fieldId}`, {
    cookieJar: viewerCookie,
    method: "PATCH",
    body: { label: "Privilege attempt" },
  });
  assert.equal(viewerCannotEditField.response.status, 403);

  const deniedGrantUpdate = await request(
    `/api/admin/datasets/${datasetId}/permissions/${users.analyst.id}`,
    { cookieJar: analystCookie, method: "PUT", body: { permissions: ["read"] } },
  );
  assert.equal(deniedGrantUpdate.response.status, 403);

  const deletedField = await request(`/api/datasets/${datasetId}/fields/${fieldId}`, {
    cookieJar: adminCookie,
    method: "DELETE",
  });
  assert.equal(deletedField.response.status, 204);
  assert.equal(
    await database.collection("datasetFields").countDocuments({ datasetId: new ObjectId(datasetId) }),
    0,
  );

  await database.collection("records").insertOne({
    datasetId: new ObjectId(datasetId),
    data: { companyName: "Delete with dataset" },
  });
  const deniedDelete = await request(`/api/datasets/${datasetId}`, {
    cookieJar: analystCookie,
    method: "DELETE",
  });
  assert.equal(deniedDelete.response.status, 403);
  const deleted = await request(`/api/datasets/${datasetId}`, {
    cookieJar: adminCookie,
    method: "DELETE",
  });
  assert.equal(deleted.response.status, 204);
  assert.equal(await database.collection("datasets").countDocuments({ _id: new ObjectId(datasetId) }), 0);
  assert.equal(await database.collection("records").countDocuments({ datasetId: new ObjectId(datasetId) }), 0);
  assert.equal(await database.collection("datasetPermissions").countDocuments({ datasetId: new ObjectId(datasetId) }), 0);
});

test("record retrieval paginates, searches, sorts, selects fields, and enforces dataset access", async () => {
  const adminCookie = cookieJars.get(users.administrator.email);
  const analystCookie = cookieJars.get(users.analyst.email);
  const viewerCookie = cookieJars.get(users.viewer.email);
  const dataset = await database.collection("datasets").insertOne({
    name: "Explorer pagination dataset",
    slug: "explorer-pagination-dataset",
    category: "Testing",
    dataSource: { name: "Test generator", type: "synthetic" },
    totalRecords: 105,
    creatorId: new ObjectId(users.administrator.id),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const datasetId = dataset.insertedId;

  await database.collection("datasetFields").insertMany([
    {
      datasetId,
      name: "companyName",
      label: "Company name",
      dataType: "string",
      searchable: true,
      sortable: true,
      filterable: true,
      visibleByDefault: true,
    },
    {
      datasetId,
      name: "industry",
      label: "Industry",
      dataType: "string",
      searchable: true,
      sortable: true,
      filterable: true,
      visibleByDefault: true,
    },
    {
      datasetId,
      name: "revenue",
      label: "Revenue",
      dataType: "currency",
      searchable: false,
      sortable: true,
      filterable: true,
      visibleByDefault: false,
    },
  ]);
  const records = Array.from({ length: 105 }, (_, index) => {
    const companyNumber = index + 1;
    return {
      datasetId,
      data: {
        companyName: companyNumber <= 3 ? `Acme Company ${companyNumber}` : `Company ${companyNumber}`,
        industry: companyNumber % 2 === 0 ? "Technology" : "Retail",
        revenue: companyNumber % 10,
        privateMemo: "not a defined field",
      },
      createdAt: new Date(Date.UTC(2025, 0, 1) + companyNumber * 1000),
      updatedAt: new Date(Date.UTC(2025, 0, 1) + companyNumber * 1000),
    };
  });
  const inserted = await database.collection("records").insertMany(records);
  const firstRecordId = inserted.insertedIds[0];
  await database.collection("datasetPermissions").insertMany([
    { datasetId, userId: users.analyst.id, permissions: ["read"] },
    { datasetId, userId: users.viewer.id, permissions: ["read"] },
  ]);

  const pageTen = await request(`/api/datasets/${datasetId}/records?page=2&pageSize=10`, {
    cookieJar: viewerCookie,
  });
  assert.equal(pageTen.response.status, 200);
  assert.equal(pageTen.body.records.length, 10);
  assert.equal(pageTen.body.page, 2);
  assert.equal(pageTen.body.pageSize, 10);
  assert.equal(pageTen.body.totalMatchingRecords, 105);
  assert.equal(pageTen.body.totalPages, 11);

  const pageFifty = await request(`/api/datasets/${datasetId}/records?page=2&pageSize=50`, {
    cookieJar: analystCookie,
  });
  assert.equal(pageFifty.response.status, 200);
  assert.equal(pageFifty.body.records.length, 50);
  assert.equal(pageFifty.body.totalPages, 3);

  const pageHundred = await request(`/api/datasets/${datasetId}/records?page=2&pageSize=100`, {
    cookieJar: viewerCookie,
  });
  assert.equal(pageHundred.response.status, 200);
  assert.equal(pageHundred.body.records.length, 5);
  assert.equal(pageHundred.body.totalPages, 2);

  const singleSorted = await request(
    `/api/datasets/${datasetId}/records?pageSize=10&sort=revenue:asc&fields=revenue`,
    { cookieJar: viewerCookie },
  );
  assert.equal(singleSorted.response.status, 200);
  assert.equal(singleSorted.body.records[0].data.revenue, 0);

  const sorted = await request(
    `/api/datasets/${datasetId}/records?pageSize=10&sort=industry:asc&sort=revenue:desc&fields=industry,revenue`,
    { cookieJar: viewerCookie },
  );
  assert.equal(sorted.response.status, 200);
  assert.equal(sorted.body.sort.length, 2);
  assert.equal(sorted.body.records[0].data.industry, "Retail");
  assert.equal(sorted.body.records[0].data.revenue, 9);
  assert.deepEqual(Object.keys(sorted.body.records[0].data).sort(), ["industry", "revenue"]);

  const defaultFieldSelection = await request(`/api/datasets/${datasetId}/records?pageSize=1`, {
    cookieJar: viewerCookie,
  });
  assert.equal(defaultFieldSelection.response.status, 200);
  assert.deepEqual(Object.keys(defaultFieldSelection.body.records[0].data).sort(), ["companyName", "industry"]);
  assert.equal("privateMemo" in defaultFieldSelection.body.records[0].data, false);

  const searched = await request(`/api/datasets/${datasetId}/records?q=Acme&pageSize=50`, {
    cookieJar: viewerCookie,
  });
  assert.equal(searched.response.status, 200);
  assert.equal(searched.body.totalMatchingRecords, 3);
  assert.ok(searched.body.records.every((record) => record.data.companyName.includes("Acme")));

  const detail = await request(`/api/datasets/${datasetId}/records/${firstRecordId}`, {
    cookieJar: viewerCookie,
  });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.record.data.companyName, "Acme Company 1");
  assert.equal("privateMemo" in detail.body.record.data, false);

  const adminPage = await request(`/api/datasets/${datasetId}/records?page=1&pageSize=10`, {
    cookieJar: adminCookie,
  });
  assert.equal(adminPage.response.status, 200);
  assert.equal(adminPage.body.records.length, 10);
  assert.equal(adminPage.body.totalMatchingRecords, 105);

  const unauthorizedDetail = await request(`/api/datasets/${datasetId}/records/${firstRecordId}`, {
    cookieJar: cookieJars.get("unregistered@datascope.test"),
  });
  assert.equal(unauthorizedDetail.response.status, 401);

  const invalidPageSize = await request(`/api/datasets/${datasetId}/records?pageSize=101`, {
    cookieJar: viewerCookie,
  });
  assert.equal(invalidPageSize.response.status, 400);
  const invalidPage = await request(`/api/datasets/${datasetId}/records?page=0`, {
    cookieJar: viewerCookie,
  });
  assert.equal(invalidPage.response.status, 400);
  const invalidSort = await request(`/api/datasets/${datasetId}/records?sort=privateMemo:asc`, {
    cookieJar: viewerCookie,
  });
  assert.equal(invalidSort.response.status, 400);
  const invalidSelection = await request(`/api/datasets/${datasetId}/records?fields=privateMemo`, {
    cookieJar: viewerCookie,
  });
  assert.equal(invalidSelection.response.status, 400);
  const unsupportedParam = await request(`/api/datasets/${datasetId}/records?limit=500000`, {
    cookieJar: viewerCookie,
  });
  assert.equal(unsupportedParam.response.status, 400);

  const ungrantedDataset = await database.collection("datasets").insertOne({
    name: "Unshared dataset",
    slug: "unshared-dataset",
  });
  const analystDenied = await request(`/api/datasets/${ungrantedDataset.insertedId}/records?page=1`, {
    cookieJar: analystCookie,
  });
  assert.equal(analystDenied.response.status, 403);
});
