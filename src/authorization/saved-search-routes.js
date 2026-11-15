import { Router } from "express";
import mongoose from "mongoose";
import { Dataset } from "../models/dataset.js";
import { DatasetAccessPermission } from "../models/dataset-access-permission.js";
import { DatasetField } from "../models/dataset-field.js";
import { SavedView } from "../models/saved-view.js";
import { SearchHistory } from "../models/search-history.js";
import { requireAuthentication } from "./middleware.js";
import { buildFilterCondition, parseSortParameters } from "./dataset-routes.js";
import { hasPermission, ROLES } from "./permissions.js";

const indexedTextFields = ["companyName", "industry", "country", "category", "contact"];
const stringFieldTypes = new Set(["string", "email", "phone"]);
const savedViewFields = [
  "name",
  "description",
  "query",
  "searchMode",
  "filters",
  "sort",
  "visibleFields",
  "sharedWith",
];
const searchFields = ["query", "searchMode", "filters", "sort"];

function parseObjectId(value) {
  if (!mongoose.isValidObjectId(value) || !/^[a-f\d]{24}$/i.test(value)) return null;
  return new mongoose.Types.ObjectId(value);
}

function validStringArray(value, maximum, maxLength) {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    value.every((item) => typeof item === "string" && item.length > 0 && item.length <= maxLength) &&
    new Set(value).size === value.length
  );
}

async function getReadableDataset(req, datasetId) {
  const dataset = await Dataset.findById(datasetId).lean();
  if (!dataset) return { status: 404, error: "Dataset not found." };
  if (req.auth.role === ROLES.ADMINISTRATOR) return { dataset };
  const permission = await DatasetAccessPermission.findOne({
    datasetId,
    userId: req.auth.userId,
    permissions: "read",
  }).lean();
  return permission
    ? { dataset }
    : { status: 403, error: "You do not have read access to this dataset." };
}

async function validateConfiguration(configuration, datasetId, req) {
  const fields = await DatasetField.find({ datasetId }).lean();
  const fieldsByName = new Map(fields.map((field) => [field.name, field]));
  const query = configuration.query ?? "";
  const searchMode = configuration.searchMode ?? "partial";
  const filters = configuration.filters ?? [];
  const sort = configuration.sort ?? [];
  const visibleFields = configuration.visibleFields ?? [];

  if (typeof query !== "string" || query.trim().length > 100) {
    return { error: "Search text must be at most 100 characters." };
  }
  if (!["partial", "exact", "text"].includes(searchMode)) {
    return { error: "Search mode must be partial, exact, or text." };
  }
  if (
    searchMode !== "partial" &&
    !hasPermission(req.auth.role, "dataset:search:advanced")
  ) {
    return { status: 403, error: "Your role does not allow advanced search modes." };
  }
  if (!Array.isArray(filters) || filters.length > 10) {
    return { error: "Provide at most 10 search filters." };
  }
  if (
    filters.length > 1 &&
    !hasPermission(req.auth.role, "dataset:filters:multiple")
  ) {
    return { status: 403, error: "Your role does not allow multiple filter conditions." };
  }
  for (const filter of filters) {
    const result = buildFilterCondition(filter, fieldsByName);
    if (result.error) return { error: result.error };
  }
  if (query.trim()) {
    const searchableFields = fields.filter((field) => field.searchable);
    if (!searchableFields.length) return { error: "This dataset has no searchable fields." };
    if (
      searchMode !== "text" &&
      !searchableFields.some((field) =>
        stringFieldTypes.has(field.dataType) ||
        (field.dataType === "object" && field.name === "contact"),
      )
    ) {
      return { error: "This dataset has no searchable text fields." };
    }
    if (
      searchMode === "text" &&
      indexedTextFields.some((name) => !searchableFields.some((field) => field.name === name))
    ) {
      return { error: "MongoDB text search requires all indexed text fields to be searchable." };
    }
  }
  if (!Array.isArray(sort) || (!validStringArray(sort, 3, 100) && sort.length !== 0)) {
    return { error: "Choose up to three valid sort rules." };
  }
  if (sort.length && !parseSortParameters(sort, fieldsByName)) {
    return { error: "Sort only by fields configured as sortable." };
  }
  if (
    !validStringArray(visibleFields, 40, 80) ||
    visibleFields.some((name) => !fieldsByName.has(name))
  ) {
    return { error: "Visible columns must be distinct fields in this dataset." };
  }
  return { value: { query: query.trim(), searchMode, filters, sort, visibleFields } };
}

function serializeSavedView(view) {
  return {
    id: view._id.toString(),
    datasetId: view.datasetId.toString(),
    ownerId: view.ownerId,
    name: view.name,
    description: view.description ?? "",
    query: view.query ?? "",
    searchMode: view.searchMode ?? "partial",
    filters: view.filters ?? [],
    sort: Array.isArray(view.sort) ? view.sort : [],
    visibleFields: view.visibleFields ?? [],
    sharedWith: view.sharedWith ?? [],
    isShared: (view.sharedWith ?? []).length > 0,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  };
}

async function validateRecipients(
  sharedWith,
  datasetId,
  database,
  existingRecipients = [],
  configuration = {},
) {
  if (!validStringArray(sharedWith, 100, 128)) {
    return "Shared users must be a list of up to 100 distinct user IDs.";
  }
  const requiresAdvancedSearch =
    configuration.searchMode !== undefined && configuration.searchMode !== "partial";
  const requiresMultipleFilters = (configuration.filters?.length ?? 0) > 1;
  for (const userId of sharedWith) {
    const user = await database.collection("user").findOne({
      $or: [{ _id: userId }, ...(parseObjectId(userId) ? [{ _id: parseObjectId(userId) }] : [])],
    });
    if (!user) return "A selected recipient does not exist.";
    if (
      requiresAdvancedSearch &&
      !hasPermission(user.role, "dataset:search:advanced")
    ) {
      return "Every recipient must be allowed to use the saved search mode.";
    }
    if (
      requiresMultipleFilters &&
      !hasPermission(user.role, "dataset:filters:multiple")
    ) {
      return "Every recipient must be allowed to use multiple filters.";
    }
    if (existingRecipients.includes(userId)) continue;
    if (user.role === ROLES.ADMINISTRATOR) continue;
    const grant = await DatasetAccessPermission.findOne({
      datasetId,
      userId,
      permissions: "read",
    }).lean();
    if (!grant) return "Every recipient must already have read access to this dataset.";
  }
  return null;
}

function validateSavedViewBody(body, partial = false) {
  const allowedFields = partial ? savedViewFields : ["datasetId", ...savedViewFields];
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !allowedFields.includes(key))
  ) {
    return "Provide only supported saved-view properties.";
  }
  if (!partial && (typeof body.name !== "string" || !body.name.trim())) {
    return "A view name is required.";
  }
  if (body.name !== undefined && (
    typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120
  )) {
    return "View name must be between 1 and 120 characters.";
  }
  if (body.description !== undefined && (
    typeof body.description !== "string" || body.description.length > 500
  )) {
    return "Description must be at most 500 characters.";
  }
  if (body.sharedWith !== undefined && !Array.isArray(body.sharedWith)) {
    return "Shared users must be a list.";
  }
  return null;
}

export function createSavedSearchRouter(auth, database) {
  const router = Router();
  router.use(requireAuthentication(auth));

  router.get("/saved-views", async (req, res, next) => {
    try {
      const datasetId = req.query.datasetId === undefined ? null : parseObjectId(req.query.datasetId);
      if (req.query.datasetId !== undefined && !datasetId) {
        res.status(400).json({ error: "Invalid dataset ID." });
        return;
      }
      if (datasetId) {
        const access = await getReadableDataset(req, datasetId);
        if (access.error) {
          res.status(access.status).json({ error: access.status === 403 ? "Forbidden" : access.error });
          return;
        }
      }
      const visibility = [{ ownerId: req.auth.userId }];
      if (hasPermission(req.auth.role, "view:access:shared")) {
        visibility.push({ sharedWith: req.auth.userId });
      }
      const query = {
        $or: visibility,
        ...(datasetId ? { datasetId } : {}),
      };
      const views = await SavedView.find(query).sort({ updatedAt: -1 }).limit(100).lean();
      const accessibleViews = [];
      for (const view of views) {
        const access = await getReadableDataset(req, view.datasetId);
        if (!access.error) accessibleViews.push(serializeSavedView(view));
      }
      res.json({ views: accessibleViews });
    } catch (error) {
      next(error);
    }
  });

  router.post("/saved-views", async (req, res, next) => {
    try {
      if (!hasPermission(req.auth.role, "view:manage:personal")) {
        res.status(403).json({ error: "Your role cannot create saved views." });
        return;
      }
      const bodyError = validateSavedViewBody(req.body);
      const datasetId = parseObjectId(req.body?.datasetId);
      if (bodyError || !datasetId) {
        res.status(400).json({ error: bodyError ?? "Invalid dataset ID." });
        return;
      }
      const access = await getReadableDataset(req, datasetId);
      if (access.error) {
        res.status(access.status).json({ error: access.status === 403 ? "Forbidden" : access.error });
        return;
      }
      const configuration = await validateConfiguration(req.body, datasetId, req);
      if (configuration.error) {
        res.status(configuration.status ?? 400).json({ error: configuration.error });
        return;
      }
      const sharedWith = req.body.sharedWith ?? [];
      const recipientError = await validateRecipients(
        sharedWith,
        datasetId,
        database,
        [],
        configuration.value,
      );
      if (recipientError) {
        res.status(400).json({ error: recipientError });
        return;
      }
      const view = await SavedView.create({
        datasetId,
        ownerId: req.auth.userId,
        name: req.body.name.trim(),
        description: req.body.description?.trim() ?? "",
        ...configuration.value,
        sharedWith,
      });
      res.status(201).json({ view: serializeSavedView(view.toObject()) });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/saved-views/:viewId", async (req, res, next) => {
    try {
      if (!hasPermission(req.auth.role, "view:manage:personal")) {
        res.status(403).json({ error: "Your role cannot manage saved views." });
        return;
      }
      const viewId = parseObjectId(req.params.viewId);
      if (!viewId) {
        res.status(400).json({ error: "Invalid saved-view ID." });
        return;
      }
      const bodyError = validateSavedViewBody(req.body, true);
      if (bodyError || !Object.keys(req.body ?? {}).length) {
        res.status(400).json({ error: bodyError ?? "Provide at least one saved-view update." });
        return;
      }
      const view = await SavedView.findById(viewId);
      if (!view) {
        res.status(404).json({ error: "Saved view not found." });
        return;
      }
      if (view.ownerId !== req.auth.userId) {
        res.status(403).json({ error: "Only the owner can edit this saved view." });
        return;
      }
      const datasetId = view.datasetId;
      const access = await getReadableDataset(req, datasetId);
      if (access.error) {
        res.status(access.status).json({ error: access.status === 403 ? "Forbidden" : access.error });
        return;
      }
      const merged = {
        query: req.body.query ?? view.query,
        searchMode: req.body.searchMode ?? view.searchMode,
        filters: req.body.filters ?? view.filters,
        sort: req.body.sort ?? view.sort,
        visibleFields: req.body.visibleFields ?? view.visibleFields,
      };
      const configuration = await validateConfiguration(merged, datasetId, req);
      if (configuration.error) {
        res.status(configuration.status ?? 400).json({ error: configuration.error });
        return;
      }
      const sharedWith = req.body.sharedWith ?? view.sharedWith;
      const recipientError = await validateRecipients(
        sharedWith,
        datasetId,
        database,
        view.sharedWith,
        configuration.value,
      );
      if (recipientError) {
        res.status(400).json({ error: recipientError });
        return;
      }
      if (req.body.name !== undefined) view.name = req.body.name.trim();
      if (req.body.description !== undefined) view.description = req.body.description.trim();
      Object.assign(view, configuration.value, { sharedWith });
      await view.save();
      res.json({ view: serializeSavedView(view.toObject()) });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/saved-views/:viewId", async (req, res, next) => {
    try {
      if (!hasPermission(req.auth.role, "view:manage:personal")) {
        res.status(403).json({ error: "Your role cannot manage saved views." });
        return;
      }
      const viewId = parseObjectId(req.params.viewId);
      if (!viewId) {
        res.status(400).json({ error: "Invalid saved-view ID." });
        return;
      }
      const view = await SavedView.findById(viewId).lean();
      if (!view) {
        res.status(404).json({ error: "Saved view not found." });
        return;
      }
      if (view.ownerId !== req.auth.userId) {
        res.status(403).json({ error: "Only the owner can delete this saved view." });
        return;
      }
      const access = await getReadableDataset(req, view.datasetId);
      if (access.error) {
        res.status(access.status).json({ error: access.status === 403 ? "Forbidden" : access.error });
        return;
      }
      await SavedView.deleteOne({ _id: viewId, ownerId: req.auth.userId });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get("/search-history", async (req, res, next) => {
    try {
      const datasetId = req.query.datasetId === undefined ? null : parseObjectId(req.query.datasetId);
      if (req.query.datasetId !== undefined && !datasetId) {
        res.status(400).json({ error: "Invalid dataset ID." });
        return;
      }
      if (datasetId) {
        const access = await getReadableDataset(req, datasetId);
        if (access.error) {
          res.status(access.status).json({ error: access.status === 403 ? "Forbidden" : access.error });
          return;
        }
      }
      const history = await SearchHistory.find({
        userId: req.auth.userId,
        ...(datasetId ? { datasetId } : {}),
      }).sort({ searchedAt: -1 }).limit(50).lean();
      const accessibleHistory = [];
      for (const item of history) {
        if (!item.datasetId) continue;
        const access = await getReadableDataset(req, item.datasetId);
        if (!access.error) {
          accessibleHistory.push({
            id: item._id.toString(),
            datasetId: item.datasetId.toString(),
            query: item.query,
            searchMode: item.searchMode ?? "partial",
            filters: item.filters ?? [],
            sort: item.sort ?? [],
            description: item.description ?? "",
            resultCount: item.resultCount ?? 0,
            searchedAt: item.searchedAt,
          });
        }
      }
      res.json({ history: accessibleHistory });
    } catch (error) {
      next(error);
    }
  });

  router.post("/search-history", async (req, res, next) => {
    try {
      const allowedKeys = ["datasetId", ...searchFields];
      if (
        !req.body ||
        typeof req.body !== "object" ||
        Array.isArray(req.body) ||
        Object.keys(req.body).some((key) => !allowedKeys.includes(key))
      ) {
        res.status(400).json({ error: "Provide only supported search-history properties." });
        return;
      }
      const datasetId = parseObjectId(req.body.datasetId);
      if (!datasetId) {
        res.status(400).json({ error: "Invalid dataset ID." });
        return;
      }
      const access = await getReadableDataset(req, datasetId);
      if (access.error) {
        res.status(access.status).json({ error: access.status === 403 ? "Forbidden" : access.error });
        return;
      }
      const configuration = await validateConfiguration(req.body, datasetId, req);
      if (configuration.error) {
        res.status(configuration.status ?? 400).json({ error: configuration.error });
        return;
      }
      const { query, searchMode, filters, sort } = configuration.value;
      if (!query && !filters.length) {
        res.status(400).json({ error: "Only searches with a query or filter can be recorded." });
        return;
      }
      const description = query
        ? query
        : `${filters.length} filter condition${filters.length === 1 ? "" : "s"}`;
      const entry = await SearchHistory.create({
        userId: req.auth.userId,
        datasetId,
        query,
        searchMode,
        filters,
        sort,
        description,
        resultCount: 0,
      });
      const expiredHistory = await SearchHistory.find({ userId: req.auth.userId })
        .sort({ searchedAt: -1, _id: -1 })
        .skip(200)
        .select("_id")
        .lean();
      if (expiredHistory.length) {
        await SearchHistory.deleteMany({
          _id: { $in: expiredHistory.map(({ _id }) => _id) },
        });
      }
      res.status(201).json({
        history: {
          id: entry._id.toString(),
          datasetId: entry.datasetId.toString(),
          query: entry.query,
          searchMode: entry.searchMode,
          filters: entry.filters,
          sort: entry.sort,
          description: entry.description,
          resultCount: entry.resultCount,
          searchedAt: entry.searchedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
