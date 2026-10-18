import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import request from "supertest";

let app: any;
let mongo: any;
let disconnectMongo: (() => Promise<void>) | undefined;

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
  const mongoModule = await import("../src/lib/mongo.js");
  disconnectMongo = mongoModule.disconnectMongo;
  await mongoModule.connectMongo();
});

after(async () => {
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

test("Google sign-in fails safely when provider credentials are not configured", async () => {
  const response = await request(app)
    .post("/api/v1/auth/google")
    .send({ idToken: "fake-but-long-enough-google-id-token", role: "CUSTOMER" });
  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, "GOOGLE_SSO_NOT_CONFIGURED");
});

test("Facebook sign-in fails safely when provider credentials are not configured", async () => {
  const response = await request(app)
    .post("/api/v1/auth/facebook")
    .send({ accessToken: "fake-but-long-enough-facebook-access-token", role: "CUSTOMER" });
  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, "FACEBOOK_SSO_NOT_CONFIGURED");
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
