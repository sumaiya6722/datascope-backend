import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth";
import { getRolePermissions } from "./authorization/permissions.js";

function omitSessionToken(response) {
  if (!response || typeof response !== "object" || response instanceof Response) {
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
      permissions: getRolePermissions(safeResponse.user.role ?? "viewer"),
    };
  }

  return safeResponse;
}

export function createAuth(database, { baseURL, frontendUrl, secret, isProduction }) {
  if (!database) {
    throw new Error("A connected MongoDB database is required to configure Better Auth.");
  }

  if (!secret || secret.length < 32 || /replace|generate/i.test(secret)) {
    throw new Error("BETTER_AUTH_SECRET must be a unique secret of at least 32 characters.");
  }

  return betterAuth({
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        // The callback URL is derived from BETTER_AUTH_URL + '/api/auth/callback/google'
        // Better Auth will automatically mount under /api/auth, so this is the default route.
        // Ensure this matches the Google Cloud Console authorized redirect URI.
        // No additional options required for basic flow.
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
          type: ["administrator", "dataAnalyst", "viewer"],
          required: false,
          defaultValue: "viewer",
          input: false,
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
        sameSite: "lax",
        secure: isProduction,
      },
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        return omitSessionToken(ctx.context.returned);
      }),
    },
  });
}
