
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth";
import { getRolePermissions, ROLES } from "./authorization/permissions.js";
import { grantDemoDatasetAccessToViewer } from "./auth/permissions.js";

function omitSessionToken(response) {
  if (
    !response ||
    typeof response !== "object" ||
    response instanceof Response
  ) {
    return response;
  }

  if (Array.isArray(response)) {
    return response.map(omitSessionToken);
  }

  const { token, ...safeResponse } = response;

  for (const key of ["session", "sessions"]) {
    if (safeResponse[key] && typeof safeResponse[key] === "object") {
      safeResponse[key] = omitSessionToken(safeResponse[key]);
    }
  }

  if (safeResponse.user && typeof safeResponse.user === "object") {
    safeResponse.user = {
      ...safeResponse.user,
      permissions: getRolePermissions(
        safeResponse.user.role ?? ROLES.VIEWER
      ),
    };
  }

  return safeResponse;
}

export function createAuth(
  database,
  { baseURL, frontendUrl, secret, isProduction }
) {
  if (!database) {
    throw new Error(
      "A connected MongoDB database is required to configure Better Auth."
    );
  }

  if (
    !secret ||
    secret.length < 32 ||
    /replace|generate/i.test(secret)
  ) {
    throw new Error(
      "BETTER_AUTH_SECRET must be a unique secret of at least 32 characters."
    );
  }

  return betterAuth({
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      },
    },

    appName: "DataScope",
    baseURL,
    secret,
    database: mongodbAdapter(database),

    trustedOrigins: [frontendUrl],

    emailAndPassword: {
      enabled: true,
    },

    user: {
      additionalFields: {
        role: {
          type: [ROLES.ADMINISTRATOR, ROLES.DATA_ANALYST, ROLES.VIEWER],
          required: false,
          defaultValue: ROLES.VIEWER,
          input: false,
        },

        requestedRole: {
          type: [ROLES.VIEWER, ROLES.DATA_ANALYST],
          required: false,
          defaultValue: ROLES.VIEWER,
          input: true,
          returned: false,
        },
      },
    },

    session: {
      additionalFields: {
        token: {
          type: "string",
          required: true,
          returned: false,
        },
      },
    },

    advanced: {
      useSecureCookies: isProduction,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: isProduction ? "none" : "lax",
        secure: isProduction,
      },
    },

    // Authentication endpoint hooks
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-up/email") {
          const requestedRole = ctx.body?.requestedRole;

          ctx.body.requestedRole =
            requestedRole === ROLES.DATA_ANALYST
              ? ROLES.DATA_ANALYST
              : ROLES.VIEWER;
        }
      }),

      after: createAuthMiddleware(async (ctx) => {
        return omitSessionToken(ctx.context.returned);
      }),
    },

    // Database lifecycle hooks
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const { requestedRole, ...userData } = user;

            const finalRole =
              requestedRole === ROLES.DATA_ANALYST
                ? ROLES.DATA_ANALYST
                : ROLES.VIEWER;

            return {
              data: {
                ...userData,
                role: finalRole,
              },
            };
          },

          after: async (user) => {
            if ([ROLES.VIEWER, ROLES.DATA_ANALYST].includes(user.role)) {
              await grantDemoDatasetAccessToViewer(
                user.id?.toString?.() ??
                user._id?.toString?.()
              );
            }
          },
        },
      },
    },
  });
}
