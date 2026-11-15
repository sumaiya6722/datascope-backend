import { Router } from "express";
import mongoose from "mongoose";
import { Dataset } from "../models/dataset.js";
import { DatasetAccessPermission } from "../models/dataset-access-permission.js";
import { DatasetField } from "../models/dataset-field.js";
import { DatasetRecord } from "../models/dataset-record.js";
import { RecordHistory } from "../models/record-history.js";
import { RecordRelationship } from "../models/record-relationship.js";
import { SavedView } from "../models/saved-view.js";
import { SearchHistory } from "../models/search-history.js";
import { requireAuthentication, requirePermission } from "./middleware.js";
import { hasPermission, ROLES } from "./permissions.js";

const fieldTypes = new Set([
  "string",
  "number",
  "date",
  "boolean",
  "email",
  "phone",
  "currency",
  "object",
]);
const fieldFlags = ["searchable", "filterable", "sortable", "visibleByDefault"];

function parseObjectId(value) {
  if (!mongoose.isValidObjectId(value) || !/^[a-f\d]{24}$/i.test(value)) {
    return null;
  }

  return new mongoose.Types.ObjectId(value);
}

function serializeDataset(dataset, totalRecords = dataset.totalRecords ?? 0) {
  return {
    id: dataset._id.toString(),
    name: dataset.name,
    description: dataset.description ?? "",
    slug: dataset.slug,
    category: dataset.category,
    dataSource: dataset.dataSource,
    totalRecords,
    creatorId: dataset.creatorId?.toString() ?? null,
    createdAt: dataset.createdAt ?? null,
    updatedAt: dataset.updatedAt ?? null,
  };
}

function validateDatasetInput(body, partial = false) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Provide a valid dataset object.";
  }

  const allowedFields = ["name", "slug", "description", "category", "dataSource"];
  if (Object.keys(body).some((key) => !allowedFields.includes(key))) {
    return "The request contains unsupported dataset fields.";
  }
  if (partial && !Object.keys(body).length) {
    return "Provide at least one dataset field to update.";
  }
  if (body.name !== undefined && (
    typeof body.name !== "string" || body.name.trim().length < 2 || body.name.trim().length > 160
  )) {
    return "Name must be between 2 and 160 characters.";
  }
  if (body.slug !== undefined && (
    typeof body.slug !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.slug.trim()) ||
    body.slug.trim().length > 180
  )) {
    return "Slug must contain lowercase letters, numbers, and single hyphens only.";
  }
  if (body.description !== undefined && (
    typeof body.description !== "string" || body.description.length > 2000
  )) {
    return "Description must be a string of at most 2,000 characters.";
  }
  if (body.category !== undefined && (
    typeof body.category !== "string" || !body.category.trim() || body.category.trim().length > 100
  )) {
    return "Category is required and must be at most 100 characters.";
  }
  if (body.dataSource !== undefined) {
    const source = body.dataSource;
    if (
      !source ||
      typeof source !== "object" ||
      Array.isArray(source) ||
      Object.keys(source).some((key) => !["name", "type", "description"].includes(key)) ||
      typeof source.name !== "string" ||
      !source.name.trim() ||
      source.name.trim().length > 120 ||
      typeof source.type !== "string" ||
      !source.type.trim() ||
      source.type.trim().length > 80 ||
      (source.description !== undefined &&
        (typeof source.description !== "string" || source.description.length > 500))
    ) {
      return "Data source requires a name and type; its description must be at most 500 characters.";
    }
  }
  if (!partial && (
    body.name === undefined ||
    body.slug === undefined ||
    body.category === undefined ||
    body.dataSource === undefined
  )) {
    return "Name, slug, category, and data source are required.";
  }

  return null;
}

function validateFieldInput(body, partial = false) {
  const allowedFields = ["name", "label", "dataType", ...fieldFlags];
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !allowedFields.includes(key)) ||
    (partial && !Object.keys(body).length)
  ) {
    return "Provide valid field properties.";
  }

  if (
    body.name !== undefined &&
    (typeof body.name !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(body.name.trim()))
  ) {
    return "Field name must start with a letter and may contain letters, numbers, and underscores (up to 80 characters).";
  }
  if (
    body.label !== undefined &&
    (typeof body.label !== "string" || !body.label.trim() || body.label.trim().length > 80)
  ) {
    return "Field label is required and must be at most 80 characters.";
  }
  if (body.dataType !== undefined && !fieldTypes.has(body.dataType)) {
    return "Choose a supported field data type.";
  }
  if (fieldFlags.some((flag) => body[flag] !== undefined && typeof body[flag] !== "boolean")) {
    return "Field options must be true or false.";
  }
  if (!partial && (!body.name || !body.label || !body.dataType)) {
    return "Field name, label, and data type are required.";
  }
  return null;
}

async function getReadableDataset(req, datasetId) {
  const dataset = await Dataset.findById(datasetId).lean();
  if (!dataset) {
    return { status: 404, error: "Dataset not found." };
  }

  if (req.auth.role === ROLES.ADMINISTRATOR) {
    return { dataset };
  }

  const grant = await DatasetAccessPermission.findOne({
    datasetId: dataset._id,
    userId: req.auth.userId,
    permissions: "read",
  }).lean();

  if (!grant) {
    return { status: 403, error: "You do not have access to this dataset." };
  }

  return { dataset, grant };
}

export function createDatasetRouter(auth, database) {
  const router = Router();

  router.get(
    "/",
    requireAuthentication(auth),
    requirePermission("dataset:read"),
    async (req, res, next) => {
      try {
        let query = {};
        if (req.auth.role !== ROLES.ADMINISTRATOR) {
          const grants = await DatasetAccessPermission.find({
            userId: req.auth.userId,
            permissions: "read",
          }).select("datasetId").lean();
          query = { _id: { $in: grants.map((grant) => grant.datasetId) } };
        }

        const datasets = await Dataset.find(query).sort({ updatedAt: -1 }).lean();
        const counts = await DatasetRecord.aggregate([
          { $match: { datasetId: { $in: datasets.map((dataset) => dataset._id) } } },
          { $group: { _id: "$datasetId", count: { $sum: 1 } } },
        ]);
        const countById = new Map(counts.map(({ _id, count }) => [_id.toString(), count]));

        res.json({
          datasets: datasets.map((dataset) =>
            serializeDataset(dataset, countById.get(dataset._id.toString()) ?? 0),
          ),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/",
    requireAuthentication(auth),
    requirePermission("dataset:manage"),
    async (req, res, next) => {
      try {
        const validationError = validateDatasetInput(req.body);
        if (validationError) {
          res.status(400).json({ error: "Invalid dataset.", message: validationError });
          return;
        }

        const dataset = await Dataset.create({
          name: req.body.name.trim(),
          slug: req.body.slug.trim().toLowerCase(),
          description: req.body.description?.trim() ?? "",
          category: req.body.category.trim(),
          dataSource: {
            name: req.body.dataSource.name.trim(),
            type: req.body.dataSource.type.trim(),
            description: req.body.dataSource.description?.trim() ?? "",
          },
          creatorId: req.auth.userId,
          totalRecords: 0,
        });
        res.status(201).json({ dataset: serializeDataset(dataset.toObject(), 0) });
      } catch (error) {
        if (error.code === 11000) {
          res.status(409).json({ error: "A dataset with this slug already exists." });
          return;
        }
        if (error.name === "ValidationError") {
          res.status(400).json({ error: "Invalid dataset.", message: error.message });
          return;
        }
        next(error);
      }
    },
  );

  router.get(
    "/:datasetId",
    requireAuthentication(auth),
    requirePermission("dataset:read"),
    async (req, res, next) => {
      try {
        const datasetId = parseObjectId(req.params.datasetId);
        if (!datasetId) {
          res.status(400).json({ error: "Invalid dataset ID." });
          return;
        }

        const access = await getReadableDataset(req, datasetId);
        if (access.error) {
          res.status(access.status).json({ error: access.status === 403 ? "Forbidden" : access.error });
          return;
        }

        const totalRecords = await DatasetRecord.countDocuments({ datasetId });
        res.json({
          dataset: serializeDataset(access.dataset, totalRecords),
          canManage: req.auth.role === ROLES.ADMINISTRATOR,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    "/:datasetId",
    requireAuthentication(auth),
    requirePermission("dataset:manage"),
    async (req, res, next) => {
      try {
        const datasetId = parseObjectId(req.params.datasetId);
        if (!datasetId) {
          res.status(400).json({ error: "Invalid dataset ID." });
          return;
        }
        const validationError = validateDatasetInput(req.body, true);
        if (validationError) {
          res.status(400).json({ error: "Invalid dataset.", message: validationError });
          return;
        }

        const updates = {};
        for (const key of ["name", "slug", "description", "category"]) {
          if (req.body[key] !== undefined) {
            updates[key] = typeof req.body[key] === "string" ? req.body[key].trim() : req.body[key];
          }
        }
        if (req.body.dataSource !== undefined) {
          updates.dataSource = {
            name: req.body.dataSource.name.trim(),
            type: req.body.dataSource.type.trim(),
            description: req.body.dataSource.description?.trim() ?? "",
          };
        }
        const dataset = await Dataset.findByIdAndUpdate(
          datasetId,
          { $set: updates },
          { returnDocument: "after", runValidators: true },
        ).lean();
        if (!dataset) {
          res.status(404).json({ error: "Dataset not found." });
          return;
        }
        const totalRecords = await DatasetRecord.countDocuments({ datasetId });
        res.json({ dataset: serializeDataset(dataset, totalRecords) });
      } catch (error) {
        if (error.code === 11000) {
          res.status(409).json({ error: "A dataset with this slug already exists." });
          return;
        }
        if (error.name === "ValidationError") {
          res.status(400).json({ error: "Invalid dataset.", message: error.message });
          return;
        }
        next(error);
      }
    },
  );

  router.delete(
    "/:datasetId",
    requireAuthentication(auth),
    requirePermission("dataset:manage"),
    async (req, res, next) => {
      try {
        const datasetId = parseObjectId(req.params.datasetId);
        if (!datasetId) {
          res.status(400).json({ error: "Invalid dataset ID." });
          return;
        }
        const dataset = await Dataset.findById(datasetId).select("_id").lean();
        if (!dataset) {
          res.status(404).json({ error: "Dataset not found." });
          return;
        }

        await Promise.all([
          DatasetField.deleteMany({ datasetId }),
          DatasetAccessPermission.deleteMany({ datasetId }),
          DatasetRecord.deleteMany({ datasetId }),
          RecordHistory.deleteMany({ datasetId }),
          RecordRelationship.deleteMany({ datasetId }),
          SavedView.deleteMany({ datasetId }),
          SearchHistory.deleteMany({ datasetId }),
        ]);
        await Dataset.deleteOne({ _id: datasetId });
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/:datasetId/fields",
    requireAuthentication(auth),
    requirePermission("dataset:read"),
    async (req, res, next) => {
      try {
        const datasetId = parseObjectId(req.params.datasetId);
        if (!datasetId) {
          res.status(400).json({ error: "Invalid dataset ID." });
          return;
        }
        const access = await getReadableDataset(req, datasetId);
        if (access.error) {
          res.status(access.status).json({ error: access.status === 403 ? "Forbidden" : access.error });
          return;
        }
        const fields = await DatasetField.find({ datasetId }).sort({ createdAt: 1 }).lean();
        res.json({ fields: fields.map(serializeField) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/:datasetId/fields",
    requireAuthentication(auth),
    requirePermission("dataset:manage"),
    async (req, res, next) => {
      try {
        const datasetId = parseObjectId(req.params.datasetId);
        if (!datasetId) {
          res.status(400).json({ error: "Invalid dataset ID." });
          return;
        }
        const validationError = validateFieldInput(req.body);
        if (validationError) {
          res.status(400).json({ error: "Invalid dataset field.", message: validationError });
          return;
        }
        if (!(await Dataset.exists({ _id: datasetId }))) {
          res.status(404).json({ error: "Dataset not found." });
          return;
        }
        const field = await DatasetField.create({
          ...req.body,
          name: req.body.name.trim(),
          label: req.body.label.trim(),
          datasetId,
        });
        res.status(201).json({ field: serializeField(field.toObject()) });
      } catch (error) {
        if (error.code === 11000) {
          res.status(409).json({ error: "A field with this name already exists in the dataset." });
          return;
        }
        if (error.name === "ValidationError") {
          res.status(400).json({ error: "Invalid dataset field.", message: error.message });
          return;
        }
        next(error);
      }
    },
  );

  router.patch(
    "/:datasetId/fields/:fieldId",
    requireAuthentication(auth),
    requirePermission("dataset:manage"),
    async (req, res, next) => {
      try {
        const datasetId = parseObjectId(req.params.datasetId);
        const fieldId = parseObjectId(req.params.fieldId);
        if (!datasetId || !fieldId) {
          res.status(400).json({ error: "Invalid dataset or field ID." });
          return;
        }
        const validationError = validateFieldInput(req.body, true);
        if (validationError) {
          res.status(400).json({ error: "Invalid dataset field.", message: validationError });
          return;
        }
        const updates = { ...req.body };
        for (const key of ["name", "label"]) {
          if (updates[key] !== undefined) updates[key] = updates[key].trim();
        }
        const field = await DatasetField.findOneAndUpdate(
          { _id: fieldId, datasetId },
          { $set: updates },
          { returnDocument: "after", runValidators: true },
        ).lean();
        if (!field) {
          res.status(404).json({ error: "Dataset field not found." });
          return;
        }
        res.json({ field: serializeField(field) });
      } catch (error) {
        if (error.code === 11000) {
          res.status(409).json({ error: "A field with this name already exists in the dataset." });
          return;
        }
        if (error.name === "ValidationError") {
          res.status(400).json({ error: "Invalid dataset field.", message: error.message });
          return;
        }
        next(error);
      }
    },
  );

  router.delete(
    "/:datasetId/fields/:fieldId",
    requireAuthentication(auth),
    requirePermission("dataset:manage"),
    async (req, res, next) => {
      try {
        const datasetId = parseObjectId(req.params.datasetId);
        const fieldId = parseObjectId(req.params.fieldId);
        if (!datasetId || !fieldId) {
          res.status(400).json({ error: "Invalid dataset or field ID." });
          return;
        }
        const result = await DatasetField.deleteOne({ _id: fieldId, datasetId });
        if (!result.deletedCount) {
          res.status(404).json({ error: "Dataset field not found." });
          return;
        }
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/:datasetId/records",
    requireAuthentication(auth),
    requirePermission("dataset:records:read"),
    async (req, res, next) => {
      try {
        const datasetId = parseObjectId(req.params.datasetId);
        if (!datasetId) {
          res.status(400).json({ error: "Invalid dataset ID." });
          return;
        }

        const access = await getReadableDataset(req, datasetId);
        if (access.error) {
          res.status(access.status).json({ error: access.status === 403 ? "Forbidden" : access.error });
          return;
        }

        const pageResult = parsePositiveInteger(req.query.page, 1, 1_000_000);
        const pageSizeResult = parsePositiveInteger(req.query.pageSize, 25, 100);
        if (!pageResult || !pageSizeResult) {
          res.status(400).json({
            error: "Invalid pagination.",
            message: "Page must be a positive integer; pageSize must be between 1 and 100.",
          });
          return;
        }

        const queryKeys = Object.keys(req.query);
        if (queryKeys.some((key) =>
          !["page", "pageSize", "sort", "fields", "q", "qMode", "filters"].includes(key),
        )) {
          res.status(400).json({ error: "Unsupported record query parameter." });
          return;
        }

        const fields = await DatasetField.find({ datasetId }).lean();
        const fieldsByName = new Map(fields.map((field) => [field.name, field]));
        const sort = parseSortParameters(req.query.sort, fieldsByName);
        if (!sort) {
          res.status(400).json({
            error: "Invalid sort.",
            message: "Sort by up to three sortable dataset fields using field:asc or field:desc.",
          });
          return;
        }

        let selectedFields;
        if (req.query.fields !== undefined) {
          if (typeof req.query.fields !== "string" || req.query.fields.length > 2000) {
            res.status(400).json({ error: "Invalid fields selection." });
            return;
          }
          selectedFields = req.query.fields.split(",").filter(Boolean);
          if (
            !selectedFields.length ||
            selectedFields.length > 40 ||
            new Set(selectedFields).size !== selectedFields.length ||
            selectedFields.some((name) => !fieldsByName.has(name))
          ) {
            res.status(400).json({
              error: "Invalid fields selection.",
              message: "Select up to 40 distinct fields defined for this dataset.",
            });
            return;
          }
        } else {
          selectedFields = fields
            .filter((field) => field.visibleByDefault)
            .map((field) => field.name);
        }

        let recordFilter = { datasetId };
        const conditions = [];
        if (req.query.filters !== undefined) {
          if (
            typeof req.query.filters !== "string" ||
            req.query.filters.length > 10_000
          ) {
            res.status(400).json({ error: "Filter conditions must be a JSON array under 10,000 characters." });
            return;
          }

          let filters;
          try {
            filters = JSON.parse(req.query.filters);
          } catch {
            res.status(400).json({ error: "Filter conditions must be valid JSON." });
            return;
          }
          if (!Array.isArray(filters) || filters.length < 1 || filters.length > 10) {
            res.status(400).json({ error: "Provide between 1 and 10 filter conditions." });
            return;
          }
          if (
            filters.length > 1 &&
            !hasPermission(req.auth.role, "dataset:filters:multiple")
          ) {
            res.status(403).json({
              error: "Forbidden",
              message: "Your role does not allow multiple filter conditions.",
            });
            return;
          }
          for (const filter of filters) {
            const result = buildFilterCondition(filter, fieldsByName);
            if (result.error) {
              res.status(400).json({ error: "Invalid filter condition.", message: result.error });
              return;
            }
            conditions.push(result.condition);
          }
        }

        let searchTerm = "";
        let searchMode = "partial";
        if (req.query.q !== undefined) {
          if (typeof req.query.q !== "string" || req.query.q.trim().length > 100) {
            res.status(400).json({ error: "Search text must be at most 100 characters." });
            return;
          }
          if (
            req.query.qMode !== undefined &&
            (typeof req.query.qMode !== "string" ||
              !["partial", "exact", "text"].includes(req.query.qMode))
          ) {
            res.status(400).json({ error: "Search mode must be partial, exact, or text." });
            return;
          }
          searchTerm = req.query.q.trim();
          searchMode = req.query.qMode ?? "partial";
          if (
            searchMode !== "partial" &&
            !hasPermission(req.auth.role, "dataset:search:advanced")
          ) {
            res.status(403).json({
              error: "Forbidden",
              message: "Your role does not allow advanced search modes.",
            });
            return;
          }
          if (searchTerm) {
            const searchableFields = fields.filter((field) => field.searchable);
            if (!searchableFields.length) {
              res.status(400).json({ error: "This dataset has no searchable fields." });
              return;
            }
            if (searchMode === "text") {
              const unsearchableIndexFields = [...textIndexedFieldNames].filter(
                (name) => !searchableFields.some((field) => field.name === name),
              );
              if (unsearchableIndexFields.length) {
                res.status(400).json({
                  error: "MongoDB text search requires every indexed text field to be configured as searchable.",
                });
                return;
              }
              recordFilter.$text = { $search: searchTerm };
            } else {
              const stringSearchableFields = searchableFields.filter((field) =>
                stringFieldTypes.has(field.dataType) ||
                (field.dataType === "object" && field.name === "contact"),
              );
              if (!stringSearchableFields.length) {
                res.status(400).json({ error: "This dataset has no searchable text fields." });
                return;
              }
              const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const expression = searchMode === "exact"
                ? `^${escapedTerm}$`
                : escapedTerm;
              conditions.push({
                $or: stringSearchableFields.flatMap((field) => {
                  const paths = field.dataType === "object" && field.name === "contact"
                    ? ["data.contact.name", "data.contact.title", "data.contact.email", "data.contact.phone"]
                    : [`data.${field.name}`];
                  return paths.map((path) => ({
                    [path]: { $regex: expression, $options: "i" },
                  }));
                }),
              });
            }
          }
        } else if (req.query.qMode !== undefined) {
          res.status(400).json({ error: "Search mode requires a search term." });
          return;
        }
        if (conditions.length) recordFilter.$and = conditions;

        const projection = {
          datasetId: 1,
          createdAt: 1,
          updatedAt: 1,
        };
        if (fields.length && selectedFields.length) {
          for (const fieldName of selectedFields) {
            projection[`data.${fieldName}`] = 1;
          }
        }
        const skip = (pageResult.value - 1) * pageSizeResult.value;
        const totalMatchingRecords = await DatasetRecord.countDocuments(recordFilter);
        const records = skip < totalMatchingRecords
          ? await DatasetRecord.find(recordFilter, projection)
              .sort(sort)
              .skip(skip)
              .limit(pageSizeResult.value)
              .lean()
          : [];
        res.json({
          dataset: serializeDataset(access.dataset),
          records: records.map((record) => ({
            id: record._id.toString(),
            datasetId: record.datasetId.toString(),
            createdAt: record.createdAt ?? null,
            updatedAt: record.updatedAt ?? null,
            data: selectRecordData(record, fields.length ? selectedFields : null),
          })),
          page: pageResult.value,
          pageSize: pageSizeResult.value,
          totalMatchingRecords,
          totalPages: Math.ceil(totalMatchingRecords / pageSizeResult.value),
          sort: Array.isArray(req.query.sort)
            ? req.query.sort
            : req.query.sort
              ? [req.query.sort]
              : [],
          fields: selectedFields,
          search: searchTerm,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/:datasetId/records/:recordId",
    requireAuthentication(auth),
    requirePermission("dataset:records:read"),
    async (req, res, next) => {
      try {
        const datasetId = parseObjectId(req.params.datasetId);
        const recordId = parseObjectId(req.params.recordId);
        if (!datasetId || !recordId) {
          res.status(400).json({ error: "Invalid dataset or record ID." });
          return;
        }
        const access = await getReadableDataset(req, datasetId);
        if (access.error) {
          res.status(access.status).json({ error: access.status === 403 ? "Forbidden" : access.error });
          return;
        }
        const fieldNames = await DatasetField.find({ datasetId: access.dataset._id })
          .distinct("name");
        const projection = {
          datasetId: 1,
          createdAt: 1,
          updatedAt: 1,
          ...Object.fromEntries(fieldNames.map((name) => [`data.${name}`, 1])),
        };
        const record = await DatasetRecord.findOne({
          _id: recordId,
          datasetId: access.dataset._id,
        }, projection).lean();
        if (!record) {
          res.status(404).json({ error: "Record not found in this dataset." });
          return;
        }
        res.json({
          record: {
            id: record._id.toString(),
            datasetId: record.datasetId.toString(),
            createdAt: record.createdAt ?? null,
            updatedAt: record.updatedAt ?? null,
            data: selectRecordData(record, fieldNames),
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/:datasetId/export",
    requireAuthentication(auth),
    requirePermission("dataset:export"),
    async (req, res, next) => {
      try {
        const datasetId = parseObjectId(req.params.datasetId);
        if (!datasetId) {
          res.status(400).json({ error: "Invalid dataset ID." });
          return;
        }

        const access = await getReadableDataset(req, datasetId);
        if (access.error) {
          res.status(access.status).json({ error: access.status === 403 ? "Forbidden" : access.error });
          return;
        }

        if (
          req.auth.role !== ROLES.ADMINISTRATOR &&
          !access.grant.permissions?.includes("export")
        ) {
          res.status(403).json({ error: "Forbidden", message: "Export is not allowed for this dataset." });
          return;
        }

        const records = await DatasetRecord.find({ datasetId: access.dataset._id })
          .limit(1000)
          .lean();
        res.json({
          dataset: serializeDataset(access.dataset),
          records: records.map((record) => ({ ...record, id: record._id.toString() })),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/:datasetId/export/csv",
    requireAuthentication(auth),
    requirePermission("dataset:export"),
    async (req, res, next) => {
      try {
        const datasetId = parseObjectId(req.params.datasetId);
        if (!datasetId) {
          res.status(400).json({ error: "Invalid dataset ID." });
          return;
        }
        const access = await getReadableDataset(req, datasetId);
        if (access.error) {
          res.status(access.status).json({ error: access.status === 403 ? "Forbidden" : access.error });
          return;
        }
        if (
          req.auth.role !== ROLES.ADMINISTRATOR &&
          !access.grant.permissions?.includes("export")
        ) {
          res.status(403).json({ error: "Forbidden", message: "Export is not allowed for this dataset." });
          return;
        }
        const allowedKeys = ["mode", "recordIds", "fields", "filters", "q", "qMode"];
        if (
          !req.body ||
          typeof req.body !== "object" ||
          Array.isArray(req.body) ||
          Object.keys(req.body).some((key) => !allowedKeys.includes(key))
        ) {
          res.status(400).json({ error: "Provide only supported CSV export options." });
          return;
        }
        const { mode, fields: requestedFields } = req.body;
        if (!["selected", "filtered"].includes(mode)) {
          res.status(400).json({ error: "Export mode must be selected or filtered." });
          return;
        }
        if (
          !Array.isArray(requestedFields) ||
          requestedFields.length < 1 ||
          requestedFields.length > 40 ||
          new Set(requestedFields).size !== requestedFields.length ||
          requestedFields.some((name) => typeof name !== "string")
        ) {
          res.status(400).json({ error: "Select between 1 and 40 distinct dataset fields." });
          return;
        }
        const fields = await DatasetField.find({ datasetId }).lean();
        const fieldsByName = new Map(fields.map((field) => [field.name, field]));
        if (requestedFields.some((name) => !fieldsByName.has(name))) {
          res.status(400).json({ error: "Requested fields must be defined for this dataset." });
          return;
        }

        let recordFilter = { datasetId };
        if (mode === "selected") {
          if (
            !Array.isArray(req.body.recordIds) ||
            req.body.recordIds.length < 1 ||
            req.body.recordIds.length > 5000 ||
            new Set(req.body.recordIds).size !== req.body.recordIds.length ||
            req.body.recordIds.some((id) => typeof id !== "string" || !parseObjectId(id))
          ) {
            res.status(400).json({ error: "Select between 1 and 5,000 distinct valid record IDs." });
            return;
          }
          recordFilter._id = { $in: req.body.recordIds.map(parseObjectId) };
        } else {
          const filters = req.body.filters ?? [];
          const query = req.body.q ?? "";
          if (
            !Array.isArray(filters) ||
            filters.length > 10 ||
            (typeof query !== "string" || query.trim().length > 100) ||
            (!filters.length && !query.trim())
          ) {
            res.status(400).json({ error: "Filtered export requires search text or up to 10 valid filters." });
            return;
          }
          if (
            filters.length > 1 &&
            !hasPermission(req.auth.role, "dataset:filters:multiple")
          ) {
            res.status(403).json({ error: "Your role does not allow multiple filter conditions." });
            return;
          }
          const conditions = [];
          for (const filter of filters) {
            const result = buildFilterCondition(filter, fieldsByName);
            if (result.error) {
              res.status(400).json({ error: "Invalid filter condition.", message: result.error });
              return;
            }
            conditions.push(result.condition);
          }
          if (query.trim()) {
            const searchMode = req.body.qMode ?? "partial";
            if (!["partial", "exact", "text"].includes(searchMode)) {
              res.status(400).json({ error: "Search mode must be partial, exact, or text." });
              return;
            }
            if (
              searchMode !== "partial" &&
              !hasPermission(req.auth.role, "dataset:search:advanced")
            ) {
              res.status(403).json({ error: "Your role does not allow advanced search modes." });
              return;
            }
            const searchableFields = fields.filter((field) => field.searchable);
            if (!searchableFields.length) {
              res.status(400).json({ error: "This dataset has no searchable fields." });
              return;
            }
            if (searchMode === "text") {
              if (textIndexedFieldNames.some((name) => !searchableFields.some((field) => field.name === name))) {
                res.status(400).json({ error: "MongoDB text search requires all indexed text fields to be searchable." });
                return;
              }
              recordFilter.$text = { $search: query.trim() };
            } else {
              const stringSearchableFields = searchableFields.filter((field) =>
                stringFieldTypes.has(field.dataType) ||
                (field.dataType === "object" && field.name === "contact"),
              );
              if (!stringSearchableFields.length) {
                res.status(400).json({ error: "This dataset has no searchable text fields." });
                return;
              }
              const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const expression = searchMode === "exact" ? `^${escaped}$` : escaped;
              conditions.push({
                $or: stringSearchableFields.flatMap((field) => {
                  const paths = field.dataType === "object" && field.name === "contact"
                    ? ["data.contact.name", "data.contact.title", "data.contact.email", "data.contact.phone"]
                    : [`data.${field.name}`];
                  return paths.map((path) => ({ [path]: { $regex: expression, $options: "i" } }));
                }),
              });
            }
          } else if (req.body.qMode !== undefined) {
            res.status(400).json({ error: "Search mode requires search text." });
            return;
          }
          if (conditions.length) recordFilter.$and = conditions;
        }

        const total = await DatasetRecord.countDocuments(recordFilter);
        if (mode === "selected" && total !== req.body.recordIds.length) {
          res.status(400).json({ error: "Every selected record must belong to this dataset." });
          return;
        }
        if (!total) {
          res.status(400).json({ error: "No records match this export." });
          return;
        }
        if (total > 5000) {
          res.status(413).json({ error: "CSV exports are limited to 5,000 records. Narrow the selection or filters." });
          return;
        }
        const projection = Object.fromEntries(
          requestedFields.map((name) => [`data.${name}`, 1]),
        );
        const records = await DatasetRecord.find(recordFilter, projection)
          .limit(5000)
          .lean();
        const escapeCell = (value) => {
          let text = value === null || value === undefined
            ? ""
            : value instanceof Date
              ? value.toISOString()
              : typeof value === "object"
                ? JSON.stringify(value)
                : String(value);
          if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
          return `"${text.replace(/"/g, '""')}"`;
        };
        const header = requestedFields
          .map((name) => escapeCell(fieldsByName.get(name).label))
          .join(",");
        const rows = records.map((record) =>
          requestedFields.map((name) => escapeCell(record.data?.[name])).join(","),
        );
        const filename = `${(access.dataset.slug ?? "dataset").replace(/[^a-z0-9-]/gi, "-")}-export.csv`;
        res.set({
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        });
        res.send([header, ...rows].join("\r\n"));
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

function serializeField(field) {
  return {
    id: field._id.toString(),
    datasetId: field.datasetId.toString(),
    name: field.name,
    label: field.label,
    dataType: field.dataType,
    searchable: field.searchable,
    filterable: field.filterable,
    sortable: field.sortable,
    visibleByDefault: field.visibleByDefault,
    createdAt: field.createdAt ?? null,
    updatedAt: field.updatedAt ?? null,
  };
}

function parsePositiveInteger(value, defaultValue, maximum) {
  if (value === undefined) return { value: defaultValue };
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) return null;
  return { value: parsed };
}

export function parseSortParameters(sortValues, fieldsByName) {
  if (sortValues === undefined) return { createdAt: -1, _id: -1 };
  const entries = Array.isArray(sortValues) ? sortValues : [sortValues];
  if (!entries.length || entries.length > 3) return null;

  const sort = {};
  for (const entry of entries) {
    if (typeof entry !== "string") return null;
    const [fieldName, direction, extra] = entry.split(":");
    const field = fieldsByName.get(fieldName);
    if (
      extra !== undefined ||
      !field ||
      !field.sortable ||
      !["asc", "desc"].includes(direction) ||
      Object.hasOwn(sort, `data.${fieldName}`)
    ) {
      return null;
    }
    sort[`data.${fieldName}`] = direction === "asc" ? 1 : -1;
  }
  sort._id = 1;
  return sort;
}

function selectRecordData(record, selectedFields) {
  const source = record.data && typeof record.data === "object"
    ? record.data
    : Object.fromEntries(
        Object.entries(record).filter(
          ([key]) => !["_id", "datasetId", "createdAt", "updatedAt", "__v"].includes(key),
        ),
      );
  if (!selectedFields) return source;
  return Object.fromEntries(
    selectedFields
      .filter((name) => Object.hasOwn(source, name))
      .map((name) => [name, source[name]]),
  );
}

const stringOperators = new Set([
  "equals",
  "notEquals",
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
]);
const numericOperators = new Set([
  "equals",
  "notEquals",
  "greaterThan",
  "lessThan",
  "greaterThanOrEqual",
  "lessThanOrEqual",
  "between",
]);
const dateOperators = new Set(["before", "after", "between"]);
const booleanOperators = new Set(["isTrue", "isFalse"]);
const stringFieldTypes = new Set(["string", "email", "phone"]);
const numericFieldTypes = new Set(["number", "currency"]);
const textIndexedFieldNames = new Set([
  "companyName",
  "industry",
  "country",
  "category",
  "contact",
]);

function isValidDateValue(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)
  ) {
    return false;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.slice(0, 10);
}

export function buildFilterCondition(filter, fieldsByName) {
  if (
    !filter ||
    typeof filter !== "object" ||
    Array.isArray(filter) ||
    Object.keys(filter).some((key) => !["field", "operator", "value", "valueTo"].includes(key))
  ) {
    return { error: "Each filter must contain only field, operator, value, and optional valueTo." };
  }

  const field = fieldsByName.get(filter.field);
  if (!field || !field.filterable) {
    return { error: "Choose a field that is configured as filterable for this dataset." };
  }
  if (typeof filter.operator !== "string") {
    return { error: "Choose a supported filter operator." };
  }

  const path = `data.${field.name}`;
  if (stringFieldTypes.has(field.dataType)) {
    if (!stringOperators.has(filter.operator) || typeof filter.value !== "string") {
      return { error: `Invalid string filter for "${field.label}".` };
    }
    const value = filter.value.trim();
    if (!value || value.length > 200 || filter.valueTo !== undefined) {
      return { error: `Enter a string value of 1-200 characters for "${field.label}".` };
    }
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expressions = {
      equals: { [path]: { $regex: `^${escaped}$`, $options: "i" } },
      notEquals: {
        [path]: {
          $exists: true,
          $not: { $regex: `^${escaped}$`, $options: "i" },
        },
      },
      contains: { [path]: { $regex: escaped, $options: "i" } },
      notContains: {
        [path]: { $exists: true, $not: { $regex: escaped, $options: "i" } },
      },
      startsWith: { [path]: { $regex: `^${escaped}`, $options: "i" } },
      endsWith: { [path]: { $regex: `${escaped}$`, $options: "i" } },
    };
    return { condition: expressions[filter.operator] };
  }

  if (numericFieldTypes.has(field.dataType)) {
    if (!numericOperators.has(filter.operator)) {
      return { error: `Invalid numeric filter for "${field.label}".` };
    }
    const parseNumber = (value) => {
      if (typeof value !== "string" || !value.trim()) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const value = parseNumber(filter.value);
    if (value === null) return { error: `Enter a valid number for "${field.label}".` };
    if (filter.operator === "between") {
      const valueTo = parseNumber(filter.valueTo);
      if (valueTo === null || value > valueTo) {
        return { error: `Enter a valid range for "${field.label}" with the lower bound first.` };
      }
      return { condition: { [path]: { $gte: value, $lte: valueTo } } };
    }
    if (filter.valueTo !== undefined) return { error: "This operator accepts only one value." };
    const operators = {
      equals: "$eq",
      notEquals: "$ne",
      greaterThan: "$gt",
      lessThan: "$lt",
      greaterThanOrEqual: "$gte",
      lessThanOrEqual: "$lte",
    };
    return {
      condition: {
        [path]: filter.operator === "notEquals"
          ? { $exists: true, $ne: value }
          : { [operators[filter.operator]]: value },
      },
    };
  }

  if (field.dataType === "date") {
    if (!dateOperators.has(filter.operator) || !isValidDateValue(filter.value)) {
      return { error: `Enter a valid date and operator for "${field.label}".` };
    }
    const value = new Date(filter.value);
    if (filter.operator === "between") {
      if (!isValidDateValue(filter.valueTo)) {
        return { error: `Enter a valid ending date for "${field.label}".` };
      }
      const valueTo = new Date(filter.valueTo);
      if (value > valueTo) return { error: "The range start must not be after its end." };
      return { condition: { [path]: { $gte: value, $lte: valueTo } } };
    }
    if (filter.valueTo !== undefined) return { error: "This operator accepts only one value." };
    return {
      condition: { [path]: { [filter.operator === "before" ? "$lt" : "$gt"]: value } },
    };
  }

  if (field.dataType === "boolean") {
    if (!booleanOperators.has(filter.operator) || filter.value !== undefined || filter.valueTo !== undefined) {
      return { error: `Choose true or false for "${field.label}".` };
    }
    return { condition: { [path]: filter.operator === "isTrue" } };
  }

  return { error: `Filtering is not supported for "${field.label}".` };
}

export async function initializeDatasetPermissionIndexes(database) {
  await database.collection("datasetPermissions").createIndex(
    { datasetId: 1, userId: 1 },
    { unique: true },
  );
  await database.collection("datasetPermissions").createIndex({ userId: 1, permissions: 1 });
}
