import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { createApp } from "../src/app.js";
import { createAuth } from "../src/auth.js";
import { getRolePermissions } from "../src/authorization/permissions.js";

const frontendUrl = "http://localhost:3000";
const secret = "test-only-better-auth-secret-with-at-least-32-characters";
let mongo;
let server;
let baseURL;
let cookieJar = new Map();

function updateCookieJar(response) {
  for (const cookie of response.headers.getSetCookie()) {
    const [cookiePair, ...attributes] = cookie.split(";");
    const separator = cookiePair.indexOf("=");
    const name = cookiePair.slice(0, separator);
    const isExpired = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));

    if (isExpired || !cookiePair.slice(separator + 1)) {
      cookieJar.delete(name);
    } else {
      cookieJar.set(name, cookiePair.slice(separator + 1));
    }
  }
}

async function request(path, { body, includeCookies = true, method = "GET" } = {}) {
  const headers = { origin: frontendUrl };

  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }

  if (includeCookies && cookieJar.size > 0) {
    headers.cookie = [...cookieJar.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  const response = await fetch(`${baseURL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  updateCookieJar(response);

  return {
    response,
    body: await response.json(),
  };
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri("datascope-auth-tests"));

  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );

  baseURL = `http://localhost:${port}`;
  const auth = createAuth(mongoose.connection.db, {
    baseURL,
    frontendUrl,
    secret,
    isProduction: false,
  });
  server = createApp(frontendUrl, auth).listen(port, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
});

after(async () => {
  if (server?.listening) {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  await mongoose.disconnect();
  await mongo?.stop();
});

test("registration, login, sessions, logout, and authorization", async () => {
  const email = "viewer@datascope.test";
  const password = "a-secure-test-password";

  const registration = await request("/api/auth/sign-up/email", {
    method: "POST",
    body: { name: "DataScope Viewer", email, password },
  });

  assert.equal(registration.response.status, 200);
  assert.equal(registration.response.headers.get("access-control-allow-origin"), frontendUrl);
  assert.equal(registration.response.headers.get("access-control-allow-credentials"), "true");
  assert.equal(registration.body.user.role, "viewer");
  assert.equal("token" in registration.body, false);

  const registrationCookies = registration.response.headers.getSetCookie();
  assert.ok(registrationCookies.length > 0);
  assert.ok(registrationCookies.every((cookie) => /httponly/i.test(cookie)));
  assert.ok(registrationCookies.every((cookie) => /samesite=lax/i.test(cookie)));

  const session = await request("/api/auth/get-session");
  assert.equal(session.response.status, 200);
  assert.equal(session.body.user.email, email);
  assert.equal("token" in session.body.session, false);
  assert.deepEqual(session.body.user.permissions, getRolePermissions("viewer"));
  assert.deepEqual(registration.body.user.permissions, getRolePermissions("viewer"));

  const currentUser = await request("/api/me");
  assert.equal(currentUser.response.status, 200);
  assert.deepEqual(currentUser.body.user, {
    id: registration.body.user.id,
    name: "DataScope Viewer",
    email,
    role: "viewer",
    permissions: [
      "dataset:read",
      "dataset:records:read",
      "dataset:search:basic",
      "dataset:filters:basic",
      "view:access:shared",
    ],
  });
  assert.equal("token" in currentUser.body, false);

  const unauthorized = await request("/api/me", { includeCookies: false });
  assert.equal(unauthorized.response.status, 401);

  const attemptedAdminRegistration = await request("/api/auth/sign-up/email", {
    method: "POST",
    body: {
      name: "Untrusted Admin",
      email: "admin-attempt@datascope.test",
      password,
      role: "administrator",
    },
  });
  assert.notEqual(attemptedAdminRegistration.body.user?.role, "administrator");
  assert.ok(attemptedAdminRegistration.response.status >= 400 || attemptedAdminRegistration.body.user.role === "viewer");

  const logout = await request("/api/auth/sign-out", { method: "POST", body: {} });
  assert.equal(logout.response.status, 200);
  assert.equal(cookieJar.size, 0);

  const unauthorizedAfterLogout = await request("/api/me");
  assert.equal(unauthorizedAfterLogout.response.status, 401);

  const invalidLogin = await request("/api/auth/sign-in/email", {
    method: "POST",
    body: { email, password: "incorrect-password" },
  });
  assert.equal(invalidLogin.response.status, 401);
  assert.equal("token" in invalidLogin.body, false);

  const login = await request("/api/auth/sign-in/email", {
    method: "POST",
    body: { email, password },
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.body.user.role, "viewer");
  assert.equal("token" in login.body, false);

  const loggedInSession = await request("/api/auth/get-session");
  assert.equal(loggedInSession.response.status, 200);
  assert.equal(loggedInSession.body.user.email, email);
  assert.equal("token" in loggedInSession.body.session, false);
});

test("production auth cookies are secure and HTTP-only", async () => {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );

  const productionURL = `https://localhost:${port}`;
  const auth = createAuth(mongoose.connection.db, {
    baseURL: productionURL,
    frontendUrl,
    secret,
    isProduction: true,
  });
  const productionServer = createApp(frontendUrl, auth).listen(port, "127.0.0.1");

  try {
    await new Promise((resolve) => productionServer.once("listening", resolve));
    const response = await fetch(`http://localhost:${port}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        origin: frontendUrl,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Secure Cookie User",
        email: "secure-cookie@datascope.test",
        password: "a-secure-test-password",
      }),
    });

    assert.equal(response.status, 200);
    const cookies = response.headers.getSetCookie();
    assert.ok(cookies.length > 0);
    assert.ok(cookies.every((cookie) => /httponly/i.test(cookie)));
    assert.ok(cookies.every((cookie) => /secure/i.test(cookie)));
  } finally {
    await new Promise((resolve, reject) =>
      productionServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
