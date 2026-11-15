import { fromNodeHeaders } from "better-auth/node";
import { hasPermission } from "./permissions.js";

export function requireAuthentication(auth) {
  return async (req, res, next) => {
    try {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });

      if (!session) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      req.auth = {
        userId: session.user.id,
        role: session.user.role,
        user: session.user,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!hasPermission(req.auth?.role, permission)) {
      res.status(403).json({ error: "Forbidden", message: "You do not have permission to perform this action." });
      return;
    }

    next();
  };
}
