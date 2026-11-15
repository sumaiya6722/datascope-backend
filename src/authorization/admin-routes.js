import { Router } from "express";
import { ObjectId } from "mongodb";
import { requireAuthentication, requirePermission } from "./middleware.js";
import { ROLE_PERMISSIONS, ROLES } from "./permissions.js";

const editableRoles = new Set([ROLES.DATA_ANALYST, ROLES.VIEWER]);
const datasetPermissions = new Set(["read", "export"]);

function parseObjectId(value) {
  if (!ObjectId.isValid(value) || new ObjectId(value).toHexString() !== value.toLowerCase()) {
    return null;
  }

  return new ObjectId(value);
}

export function createAdminRouter(auth, database) {
  const router = Router();

  router.use(requireAuthentication(auth));

  router.get("/users", requirePermission("user:manage"), async (req, res, next) => {
    try {
      const users = await database
        .collection("user")
        .find({}, { projection: { name: 1, email: 1, role: 1, createdAt: 1 } })
        .toArray();
      res.json({
        users: users.map((user) => ({
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role ?? ROLES.VIEWER,
          createdAt: user.createdAt ?? null,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/users/:userId/role", requirePermission("user:manage"), async (req, res, next) => {
    try {
      const userId = parseObjectId(req.params.userId);
      if (!userId || !editableRoles.has(req.body.role)) {
        res.status(400).json({
          error: "Invalid role assignment.",
          message: "The role must be dataAnalyst or viewer. Administrator assignment is available only through the first-admin initializer.",
        });
        return;
      }

      const result = await database.collection("user").updateOne(
        { _id: userId, role: { $ne: ROLES.ADMINISTRATOR } },
        { $set: { role: req.body.role, updatedAt: new Date() } },
      );

      if (!result.matchedCount) {
        const user = await database.collection("user").findOne(
          { _id: userId },
          { projection: { role: 1 } },
        );
        res.status(user ? 409 : 404).json({
          error: user
            ? "Administrator role is managed through the bootstrap process."
            : "User not found.",
        });
        return;
      }

      res.json({ userId: userId.toString(), role: req.body.role });
    } catch (error) {
      next(error);
    }
  });

  router.get("/analytics", requirePermission("analytics:admin"), async (req, res, next) => {
    try {
      const [users, datasets, records] = await Promise.all([
        database.collection("user").countDocuments(),
        database.collection("datasets").countDocuments(),
        database.collection("records").countDocuments(),
      ]);

      res.json({ users, datasets, records });
    } catch (error) {
      next(error);
    }
  });

  router.get("/system-config", requirePermission("system:manage"), (req, res) => {
    res.json({
      application: "DataScope",
      roles: Object.keys(ROLE_PERMISSIONS),
    });
  });

  router.get(
    "/datasets/:datasetId/permissions",
    requirePermission("dataset:permissions:manage"),
    async (req, res, next) => {
      try {
        const datasetId = parseObjectId(req.params.datasetId);
        if (!datasetId) {
          res.status(400).json({ error: "Invalid dataset ID." });
          return;
        }

        const [dataset, grants] = await Promise.all([
          database.collection("datasets").findOne(
            { _id: datasetId },
            { projection: { _id: 1 } },
          ),
          database.collection("datasetPermissions").find({ datasetId }).toArray(),
        ]);
        if (!dataset) {
          res.status(404).json({ error: "Dataset not found." });
          return;
        }

        const userIds = grants.map((grant) => new ObjectId(grant.userId));
        const users = userIds.length
          ? await database.collection("user").find(
              { _id: { $in: userIds } },
              { projection: { name: 1, email: 1, role: 1 } },
            ).toArray()
          : [];
        const usersById = new Map(users.map((user) => [user._id.toString(), user]));
        res.json({
          permissions: grants.map((grant) => {
            const user = usersById.get(grant.userId);
            return {
              userId: grant.userId,
              name: user?.name ?? "Unknown user",
              email: user?.email ?? "",
              role: user?.role ?? ROLES.VIEWER,
              permissions: grant.permissions,
              grantedBy: grant.grantedBy ?? null,
              updatedAt: grant.updatedAt ?? grant.createdAt ?? null,
            };
          }),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    "/datasets/:datasetId/permissions/:userId",
    requirePermission("dataset:permissions:manage"),
    async (req, res, next) => {
      try {
        const datasetId = parseObjectId(req.params.datasetId);
        const userId = parseObjectId(req.params.userId);
        const permissions = req.body?.permissions;

        if (
          !req.body ||
          typeof req.body !== "object" ||
          Array.isArray(req.body) ||
          Object.keys(req.body).some((key) => key !== "permissions") ||
          !datasetId ||
          !userId ||
          !Array.isArray(permissions) ||
          permissions.length === 0 ||
          permissions.some((permission) => !datasetPermissions.has(permission)) ||
          new Set(permissions).size !== permissions.length
        ) {
          res.status(400).json({ error: "Invalid dataset permission assignment." });
          return;
        }

        const [dataset, user] = await Promise.all([
          database.collection("datasets").findOne({ _id: datasetId }, { projection: { _id: 1 } }),
          database.collection("user").findOne({ _id: userId }, { projection: { _id: 1 } }),
        ]);

        if (!dataset) {
          res.status(404).json({ error: "Dataset not found." });
          return;
        }
        if (!user) {
          res.status(404).json({ error: "User not found." });
          return;
        }

        await database.collection("datasetPermissions").updateOne(
          { datasetId, userId: userId.toString() },
          {
            $set: {
              permissions,
              grantedBy: req.auth.userId,
              updatedAt: new Date(),
            },
            $setOnInsert: { createdAt: new Date() },
          },
          { upsert: true },
        );

        res.json({ datasetId: datasetId.toString(), userId: userId.toString(), permissions });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    "/datasets/:datasetId/permissions/:userId",
    requirePermission("dataset:permissions:manage"),
    async (req, res, next) => {
      try {
        const datasetId = parseObjectId(req.params.datasetId);
        const userId = parseObjectId(req.params.userId);

        if (!datasetId || !userId) {
          res.status(400).json({ error: "Invalid dataset or user ID." });
          return;
        }

        await database.collection("datasetPermissions").deleteOne({
          datasetId,
          userId: userId.toString(),
        });
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
