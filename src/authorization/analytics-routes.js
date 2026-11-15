import { Router } from "express";
import { DatasetAccessPermission } from "../models/dataset-access-permission.js";
import { DatasetRecord } from "../models/dataset-record.js";
import { SearchHistory } from "../models/search-history.js";
import { requireAuthentication, requirePermission } from "./middleware.js";
import { ROLES } from "./permissions.js";

export function createAnalyticsRouter(auth) {
  const router = Router();

  router.get(
    "/",
    requireAuthentication(auth),
    requirePermission("dataset:analyze"),
    async (req, res, next) => {
      try {
        let datasetIds;
        if (req.auth.role === ROLES.ADMINISTRATOR) {
          datasetIds = null;
        } else {
          const grants = await DatasetAccessPermission.find({
            userId: req.auth.userId,
            permissions: "read",
          }).distinct("datasetId");
          datasetIds = grants;
        }

        const datasetMatch = datasetIds ? { datasetId: { $in: datasetIds } } : {};
        const [recordAnalytics, searchActivity, frequentFilters] = await Promise.all([
          DatasetRecord.aggregate([
            { $match: datasetMatch },
            {
              $facet: {
                total: [{ $count: "count" }],
                categories: [
                  { $group: { _id: "$data.category", count: { $sum: 1 } } },
                  { $sort: { count: -1, _id: 1 } },
                ],
                statuses: [
                  { $group: { _id: "$data.status", count: { $sum: 1 } } },
                  { $sort: { count: -1, _id: 1 } },
                ],
                growth: [
                  {
                    $group: {
                      _id: { $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: "UTC" } },
                      count: { $sum: 1 },
                    },
                  },
                  { $sort: { _id: 1 } },
                  { $limit: 24 },
                ],
              },
            },
          ]),
          SearchHistory.aggregate([
            { $match: { datasetId: datasetIds ? { $in: datasetIds } : { $exists: true, $ne: null } } },
            {
              $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$searchedAt", timezone: "UTC" } },
                count: { $sum: 1 },
              },
            },
            { $sort: { _id: -1 } },
            { $limit: 30 },
            { $sort: { _id: 1 } },
          ]),
          SearchHistory.aggregate([
            { $match: { datasetId: datasetIds ? { $in: datasetIds } : { $exists: true, $ne: null } } },
            { $unwind: "$filters" },
            {
              $group: {
                _id: {
                  field: "$filters.field",
                  operator: "$filters.operator",
                },
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1, "_id.field": 1, "_id.operator": 1 } },
            { $limit: 10 },
          ]),
        ]);
        const result = recordAnalytics[0] ?? {
          total: [],
          categories: [],
          statuses: [],
          growth: [],
        };
        res.json({
          totalRecords: result.total[0]?.count ?? 0,
          recordsByCategory: result.categories.map(({ _id, count }) => ({
            category: _id ?? "Uncategorized",
            count,
          })),
          recordsByStatus: result.statuses.map(({ _id, count }) => ({
            status: _id ?? "Unknown",
            count,
          })),
          dataGrowth: result.growth.map(({ _id, count }) => ({ month: _id, count })),
          searchActivity: searchActivity.map(({ _id, count }) => ({ date: _id, count })),
          frequentFilters: frequentFilters.map(({ _id, count }) => ({
            field: _id.field,
            operator: _id.operator,
            count,
          })),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
