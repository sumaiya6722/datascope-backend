import express from "express";
import { createApp } from "./express-app.js";
import { createAuth } from "./auth.js";
import { connectDatabase } from "./config/database.js";
import { initializeDataModels } from "./models/index.js";

const port = Number(process.env.PORT ?? 5000);
const frontendUrl = process.env.FRONTEND_URL;
const authUrl = process.env.BETTER_AUTH_URL;
const authSecret = process.env.BETTER_AUTH_SECRET;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

// if (!frontendUrl) {
//   throw new Error("FRONTEND_URL is required to start the backend.");
// }

let parsedFrontendUrl;
try {
  parsedFrontendUrl = new URL(frontendUrl);
} catch {
  throw new Error("FRONTEND_URL must be an HTTP(S) origin without a path or trailing slash.");
}

if (
  !["http:", "https:"].includes(parsedFrontendUrl.protocol) ||
  parsedFrontendUrl.origin !== frontendUrl
) {
  throw new Error("FRONTEND_URL must be an HTTP(S) origin without a path or trailing slash.");
}

if (!authUrl) {
  throw new Error("BETTER_AUTH_URL is required to start the backend.");
}

let parsedAuthUrl;
try {
  parsedAuthUrl = new URL(authUrl);
} catch {
  throw new Error("BETTER_AUTH_URL must be an HTTP(S) origin without a path or trailing slash.");
}

if (!["http:", "https:"].includes(parsedAuthUrl.protocol) || parsedAuthUrl.origin !== authUrl) {
  throw new Error("BETTER_AUTH_URL must be an HTTP(S) origin without a path or trailing slash.");
}

if (!authSecret || authSecret.length < 32 || /replace|generate/i.test(authSecret)) {
  throw new Error("BETTER_AUTH_SECRET must be a unique secret of at least 32 characters.");
}

try {
  const database = await connectDatabase(process.env.MONGODB_URI);
  await initializeDataModels();
  const auth = createAuth(database, {
    baseURL: authUrl,
    frontendUrl,
    secret: authSecret,
    isProduction: process.env.NODE_ENV === "production",
  });
  const app = createApp(frontendUrl, auth, database, express());

  app.listen(port, () => {
    console.log(`DataScope API listening on http://localhost:${port}`);
  });
} catch (error) {
  console.error("Failed to start the DataScope API:", error);
  process.exitCode = 1;
}
