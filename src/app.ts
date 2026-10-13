import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { healthRouter } from "./routes/health.routes.js";
import { carsRouter } from "./modules/cars/cars.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { dealerCarsRouter } from "./modules/dealer/dealer-cars.routes.js";
import { dealerImagesRouter } from "./modules/dealer/dealer-images.routes.js";
import { adminRouter } from "./modules/admin/admin.routes.js";
import { favoritesRouter } from "./modules/favorites/favorites.routes.js";
import { customerEnquiriesRouter } from "./modules/enquiries/customer-enquiries.routes.js";
import { dealerEnquiriesRouter } from "./modules/enquiries/dealer-enquiries.routes.js";
import { customerTestDrivesRouter } from "./modules/test-drives/customer.routes.js";
import { dealerTestDrivesRouter } from "./modules/test-drives/dealer.routes.js";
import { notificationsRouter } from "./modules/notifications/notifications.routes.js";
import { customerProfileRouter } from "./modules/users/customer-profile.routes.js";
import { sellCarRouter } from "./modules/enquiries/sell-car.routes.js";

export const app = express();

app.disable("x-powered-by");
app.use(helmet({
  // Swagger UI loads its CSS/JS bundle from the CDN. Allow those assets while
  // keeping the API's other Helmet protections enabled.
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdn.jsdelivr.net"],
      "style-src": ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
      "font-src": ["'self'", "https://unpkg.com", "https://cdn.jsdelivr.net", "https://fonts.gstatic.com", "data:"],
      "connect-src": ["'self'"],
      "img-src": ["'self'", "data:", "https:"],
    },
  },
}));

// Serve the OpenAPI YAML file and a lightweight Swagger UI page without requiring
// an extra package dependency. Swagger UI assets are loaded from the official CDN.
app.get("/openapi.yaml", (_req, res) => {
  res.sendFile("openapi.yaml", { root: "docs" });
});
app.get("/api-docs", (_req, res) => res.redirect(302, "/api-docs/"));
app.get("/api-docs/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SM Associate Cars API — Swagger UI</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
  <style>html{box-sizing:border-box;overflow-y:scroll}*,*:before,*:after{box-sizing:inherit}body{margin:0;background:#fafafa}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function () {
      window.ui = SwaggerUIBundle({
        url: "/openapi.yaml",
        dom_id: "#swagger-ui",
        deepLinking: true,
        displayRequestDuration: true,
        presets: [SwaggerUIBundle.presets.apis],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>`);
});

// CORS is needed for browser-based clients (website, admin console, Swagger UI).
// Native React Native requests do not send an Origin header, so they are not blocked.
// WEB_ORIGIN supports a comma-separated allowlist, for example:
// https://your-site.vercel.app,https://www.your-domain.com
const configuredOrigins = env.WEB_ORIGIN.split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

const corsOptions: import("cors").CorsOptions = {
  origin(origin, callback) {
    // Requests without Origin include React Native and server-to-server requests.
    if (!origin) {
      callback(null, true);
      return;
    }

    const normalizedOrigin = origin.replace(/\/$/, "");
    const isLocalDevelopment =
      env.NODE_ENV !== "production" &&
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalizedOrigin);

    if (configuredOrigins.includes(normalizedOrigin) || isLocalDevelopment) {
      callback(null, true);
      return;
    }

    callback(new Error("CORS origin is not allowed"));
  },
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept", "Origin", "X-Requested-With"],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
// Explicitly finish CORS preflight requests before the API rate limiter and routes.
app.options(/.*/, cors(corsOptions));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

// Authentication routes also have stricter per-route limits. This outer limit protects
// the rest of the API from accidental loops and basic request floods.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: "RATE_LIMITED", message: "Too many requests. Please wait and try again." },
  },
});
app.use(env.API_BASE_PATH, apiLimiter);
app.use(env.API_BASE_PATH, (_req, res, next) => {
  // Prevent browsers and intermediary caches from retaining account, enquiry, or admin API responses.
  // Public image responses set their own explicit cache policy in the image delivery route.
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.get("/health", (_req, res) => {
  res.status(200).json({ success: true, data: { status: "ok" } });
});

app.use(`${env.API_BASE_PATH}/health`, healthRouter);
app.use(`${env.API_BASE_PATH}/cars`, carsRouter);
app.use(`${env.API_BASE_PATH}/auth`, authRouter);
app.use(`${env.API_BASE_PATH}/dealer/cars`, dealerCarsRouter);
app.use(`${env.API_BASE_PATH}/dealer/cars`, dealerImagesRouter);
app.use(`${env.API_BASE_PATH}/admin`, adminRouter);
app.use(`${env.API_BASE_PATH}/favorites`, favoritesRouter);
app.use(`${env.API_BASE_PATH}/enquiries`, customerEnquiriesRouter);
app.use(`${env.API_BASE_PATH}/sell-car-requests`, sellCarRouter);
app.use(`${env.API_BASE_PATH}/dealer/enquiries`, dealerEnquiriesRouter);
app.use(`${env.API_BASE_PATH}/test-drives`, customerTestDrivesRouter);
app.use(`${env.API_BASE_PATH}/dealer/test-drives`, dealerTestDrivesRouter);
app.use(`${env.API_BASE_PATH}/notifications`, notificationsRouter);
app.use(`${env.API_BASE_PATH}/users`, customerProfileRouter);

app.get(env.API_BASE_PATH, (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      name: "SM Associate Cars API",
      version: "v1",
      modules: ["auth", "dealers", "cars", "enquiries", "favorites", "admin"],
    },
  });
});

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: { code: "NOT_FOUND", message: "The requested endpoint was not found." },
  });
});

app.use(errorHandler);
