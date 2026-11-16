import cors from "cors";
import express from "express";
import { toNodeHandler } from "better-auth/node";
import { createAdminRouter } from "./authorization/admin-routes.js";
import { createAnalyticsRouter } from "./authorization/analytics-routes.js";
import { createDatasetRouter } from "./authorization/dataset-routes.js";
import { createSavedSearchRouter } from "./authorization/saved-search-routes.js";
import { requireAuthentication } from "./authorization/middleware.js";
import { getRolePermissions } from "./authorization/permissions.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import healthRouter from "./routes/health.js";

export function createApp(frontendUrl, auth, database) {
  const app = express();

  app.use(
    cors({
      origin: frontendUrl,
      credentials: true,
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
    }),
  );

  app.all("/api/auth", toNodeHandler(auth));
  app.all("/api/auth/*splat", toNodeHandler(auth));

  app.use(express.json());
  app.use("/api/health", healthRouter);
  app.get("/api/me", requireAuthentication(auth), (req, res) => {
    res.json({
      user: {
        id: req.auth.userId,
        name: req.auth.user.name,
        email: req.auth.user.email,
        role: req.auth.role,
        permissions: getRolePermissions(req.auth.role),
      },
    });
  });
  app.use("/api/datasets", createDatasetRouter(auth, database));
  app.use("/api/analytics", createAnalyticsRouter(auth));
  app.use("/api", createSavedSearchRouter(auth, database));
  app.use("/api/admin", createAdminRouter(auth, database));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
