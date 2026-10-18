import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import request from "supertest";

let app: any;
let mongo: any;
let disconnectMongo: (() => Promise<void>) | undefined;
let runtimeEnv: any;
const originalFetch = globalThis.fetch;

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.JWT_ACCESS_SECRET = "test-only-secret-with-at-least-32-characters";
  process.env.JWT_ACCESS_TTL_SECONDS = "900";
  process.env.REFRESH_TOKEN_DAYS = "30";
  process.env.WEB_ORIGIN = "https://sm-associate.example";
  process.env.PUBLIC_API_URL = "http://localhost:5000";
  process.env.GOOGLE_CLIENT_IDS = "";
  process.env.FACEBOOK_APP_ID = "";
  process.env.FACEBOOK_APP_SECRET = "";

  const { MongoMemoryServer } = await import("mongodb-memory-server");
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri("sm_associate_api_test");

  const serverModule = await import("../src/app.js");
  app = serverModule.app;
  runtimeEnv = (await import("../src/config/env.js")).env;
  const mongoModule = await import("../src/lib/mongo.js");
  disconnectMongo = mongoModule.disconnectMongo;
  await mongoModule.connectMongo();

  // Mock only the external identity-provider endpoints. API routing, validation,
  // MongoDB persistence, token issuance and session middleware remain real.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/tokeninfo") {
      if (url.searchParams.get("id_token") !== "valid-google-id-token-for-integration-tests") {
        return new Response(JSON.stringify({ error: "invalid_token" }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      return Response.json({
        sub: "google-provider-user-001",
        aud: "google-client-test",
        iss: "https://accounts.google.com",
        exp: String(Math.floor(Date.now() / 1000) + 3600),
        email: "google.integration@example.test",
        email_verified: true,
        name: "Google Integration User",
      });
    }
    if (url.hostname === "graph.facebook.com" && url.pathname === "/debug_token") {
      const valid = url.searchParams.get("input_token") === "valid-facebook-access-token-for-integration-tests";
      return Response.json({ data: valid ? {
        app_id: "facebook-app-test",
        is_valid: true,
        user_id: "facebook-provider-user-001",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      } : { app_id: "facebook-app-test", is_valid: false, user_id: "invalid", expires_at: 0 } });
    }
    if (url.hostname === "graph.facebook.com" && url.pathname === "/me") {
      if (url.searchParams.get("access_token") !== "valid-facebook-access-token-for-integration-tests") {
        return new Response(JSON.stringify({ error: "invalid_token" }), { status: 401, headers: { "Content-Type": "application/json" } });
      }
      return Response.json({ id: "facebook-provider-user-001", name: "Facebook Integration User", email: "facebook.integration@example.test" });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
});

after(async () => {
  globalThis.fetch = originalFetch;
  if (disconnectMongo) await disconnectMongo();
  if (mongo) await mongo.stop();
});

test("health endpoint reports the API is reachable", async () => {
  const response = await request(app).get("/health");
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.status, "ok");
});

test("customer can register, sign in, refresh a session, and sign out", async () => {
  const registration = await request(app)
    .post("/api/v1/auth/register/customer")
    .send({
      name: "Automated Test Customer",
      phone: "+15555550123",
      email: "customer.integration@example.test",
      password: "SecureTestPass!123",
      confirmPassword: "SecureTestPass!123",
    });

  assert.equal(registration.status, 201, JSON.stringify(registration.body));
  assert.equal(registration.body.data.user.role, "CUSTOMER");
  assert.ok(registration.body.data.accessToken);
  assert.ok(registration.body.data.refreshToken);

  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({
      identifier: "customer.integration@example.test",
      password: "SecureTestPass!123",
      role: "CUSTOMER",
    });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.ok(login.body.data.accessToken);
  assert.ok(login.body.data.refreshToken);

  const currentUser = await request(app)
    .get("/api/v1/auth/me")
    .set("Authorization", `Bearer ${login.body.data.accessToken}`);
  assert.equal(currentUser.status, 200);
  assert.equal(currentUser.body.data.email, "customer.integration@example.test");

  const wrongRole = await request(app)
    .post("/api/v1/auth/login")
    .send({
      identifier: "customer.integration@example.test",
      password: "SecureTestPass!123",
      role: "DEALER",
    });
  assert.equal(wrongRole.status, 403);

  const oldRefreshToken = login.body.data.refreshToken;
  const refresh = await request(app)
    .post("/api/v1/auth/refresh")
    .send({ refreshToken: oldRefreshToken });
  assert.equal(refresh.status, 200, JSON.stringify(refresh.body));
  assert.ok(refresh.body.data.accessToken);
  assert.notEqual(refresh.body.data.refreshToken, oldRefreshToken);

  const reusedRefreshToken = await request(app)
    .post("/api/v1/auth/refresh")
    .send({ refreshToken: oldRefreshToken });
  assert.equal(reusedRefreshToken.status, 401);

  const logout = await request(app)
    .post("/api/v1/auth/logout")
    .send({ refreshToken: refresh.body.data.refreshToken });
  assert.equal(logout.status, 200);
  const afterLogout = await request(app)
    .post("/api/v1/auth/refresh")
    .send({ refreshToken: refresh.body.data.refreshToken });
  assert.equal(afterLogout.status, 401);
});

test("Google sign-in rejects missing provider configuration safely", async () => {
  const response = await request(app)
    .post("/api/v1/auth/google")
    .send({ idToken: "fake-but-long-enough-google-id-token", role: "CUSTOMER" });
  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, "GOOGLE_SSO_NOT_CONFIGURED");
});

test("Google sign-in verifies the ID token and issues an API session", async () => {
  runtimeEnv.GOOGLE_CLIENT_IDS = "google-client-test";
  const response = await request(app)
    .post("/api/v1/auth/google")
    .send({ idToken: "valid-google-id-token-for-integration-tests", role: "CUSTOMER" });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.data.user.email, "google.integration@example.test");
  assert.equal(response.body.data.user.role, "CUSTOMER");
  assert.ok(response.body.data.accessToken);
  assert.ok(response.body.data.refreshToken);

  const currentUser = await request(app)
    .get("/api/v1/auth/me")
    .set("Authorization", `Bearer ${response.body.data.accessToken}`);
  assert.equal(currentUser.status, 200);
  assert.equal(currentUser.body.data.id, response.body.data.user.id);

  const roleMismatch = await request(app)
    .post("/api/v1/auth/google")
    .send({ idToken: "valid-google-id-token-for-integration-tests", role: "DEALER", businessName: "Test Dealer", city: "Tirunelveli" });
  assert.equal(roleMismatch.status, 403);
  assert.equal(roleMismatch.body.error.code, "ROLE_MISMATCH");
});

test("Google sign-in rejects invalid provider tokens", async () => {
  runtimeEnv.GOOGLE_CLIENT_IDS = "google-client-test";
  const response = await request(app)
    .post("/api/v1/auth/google")
    .send({ idToken: "invalid-google-id-token-for-integration-tests", role: "CUSTOMER" });
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, "INVALID_GOOGLE_TOKEN");
});

test("Facebook sign-in verifies the access token and issues an API session", async () => {
  runtimeEnv.FACEBOOK_APP_ID = "facebook-app-test";
  runtimeEnv.FACEBOOK_APP_SECRET = "facebook-secret-test";
  const response = await request(app)
    .post("/api/v1/auth/facebook")
    .send({ accessToken: "valid-facebook-access-token-for-integration-tests", role: "CUSTOMER" });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.data.user.email, "facebook.integration@example.test");
  assert.equal(response.body.data.user.role, "CUSTOMER");
  assert.ok(response.body.data.accessToken);
  assert.ok(response.body.data.refreshToken);
});

test("Facebook sign-in rejects invalid provider tokens", async () => {
  runtimeEnv.FACEBOOK_APP_ID = "facebook-app-test";
  runtimeEnv.FACEBOOK_APP_SECRET = "facebook-secret-test";
  const response = await request(app)
    .post("/api/v1/auth/facebook")
    .send({ accessToken: "invalid-facebook-access-token-for-integration-tests", role: "CUSTOMER" });
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, "INVALID_FACEBOOK_TOKEN");
});

test("browser CORS preflight is handled for the configured website origin", async () => {
  const response = await request(app)
    .options("/api/v1/auth/login")
    .set("Origin", "https://sm-associate.example")
    .set("Access-Control-Request-Method", "POST")
    .set("Access-Control-Request-Headers", "content-type,authorization");
  assert.equal(response.status, 204);
  assert.equal(response.headers["access-control-allow-origin"], "https://sm-associate.example");
});
