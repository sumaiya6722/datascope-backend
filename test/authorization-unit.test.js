import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFilterCondition, parseSortParameters } from "../src/authorization/dataset-routes.js";
import { hasPermission, ROLE_PERMISSIONS, ROLES } from "../src/authorization/permissions.js";
import { seedSyntheticBusinessData } from "../src/scripts/seed-demo-data.js";

test("the backend defines exactly the three supported roles and enforces their capabilities", () => {
  assert.deepEqual(Object.keys(ROLE_PERMISSIONS).sort(), [
    ROLES.ADMINISTRATOR,
    ROLES.DATA_ANALYST,
    ROLES.VIEWER,
  ].sort());
  assert.ok(hasPermission(ROLES.ADMINISTRATOR, "user:manage"));
  assert.ok(hasPermission(ROLES.DATA_ANALYST, "dataset:search:advanced"));
  assert.ok(hasPermission(ROLES.DATA_ANALYST, "dataset:export"));
  assert.ok(!hasPermission(ROLES.DATA_ANALYST, "user:manage"));
  assert.ok(hasPermission(ROLES.VIEWER, "dataset:search:basic"));
  assert.ok(!hasPermission(ROLES.VIEWER, "dataset:export"));
  assert.ok(!hasPermission(ROLES.VIEWER, "dataset:filters:multiple"));
});

test("filter construction validates field types and escapes user string input", () => {
  const fields = new Map([
    ["country", { name: "country", label: "Country", dataType: "string", filterable: true }],
    ["revenue", { name: "revenue", label: "Revenue", dataType: "currency", filterable: true }],
  ]);
  const stringFilter = buildFilterCondition(
    { field: "country", operator: "contains", value: "FR.*" },
    fields,
  );
  assert.equal(stringFilter.condition["data.country"].$regex, "FR\\.\\*");
  const numericRange = buildFilterCondition(
    { field: "revenue", operator: "between", value: "10000", valueTo: "20000" },
    fields,
  );
  assert.deepEqual(numericRange.condition, { "data.revenue": { $gte: 10_000, $lte: 20_000 } });
  assert.ok(buildFilterCondition(
    { field: "revenue", operator: "contains", value: "10" },
    fields,
  ).error);
  assert.ok(buildFilterCondition(
    { field: "unknown", operator: "equals", value: "x" },
    fields,
  ).error);
});

test("sorting accepts only declared sortable dataset fields", () => {
  const fields = new Map([
    ["revenue", { name: "revenue", sortable: true }],
    ["country", { name: "country", sortable: false }],
  ]);
  assert.deepEqual(parseSortParameters(["revenue:desc"], fields), {
    "data.revenue": -1,
    _id: 1,
  });
  assert.equal(parseSortParameters(["country:asc"], fields), null);
  assert.equal(parseSortParameters(["revenue:desc;drop"], fields), null);
});

test("the demo seed helper can be imported without connecting to or mutating a database", () => {
  assert.equal(typeof seedSyntheticBusinessData, "function");
});
