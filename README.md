# SM Associate Cars — MongoDB API

Shared REST API for the SM Associate Cars customer app, dealer app, public website and administrator console.

## Stack

- Node.js 22+, TypeScript and Express
- **MongoDB with Mongoose** (PostgreSQL, Prisma and Cloudinary removed)
- Vehicle photos stored as binary image data in MongoDB (`CarImage`); no external image-hosting service is required
- Zod validation, Helmet, CORS and standardized API errors
- JWT access tokens and hashed, rotating refresh tokens
- GitHub Actions typecheck and build validation

## Local development

1. Create a MongoDB database using MongoDB Atlas or a local MongoDB server.
2. Copy `.env.example` to `.env`.
3. Set `MONGODB_URI` to your MongoDB connection string and set a strong random `JWT_ACCESS_SECRET` of at least 32 characters.
4. Set `WEB_ORIGIN` to the website origin and `PUBLIC_API_URL` to the public API origin (for example, `https://api.example.com`, without `/api/v1`). Production startup requires `PUBLIC_API_URL` so uploaded image links never trust the incoming Host header.
5. Run `npm install`, then `npm run dev`.

The API connects to MongoDB before listening for requests. The connection string must point to a reachable database; production should use a managed MongoDB Atlas cluster rather than `localhost`.

Health endpoint: `GET /health`  
Versioned API root: `GET /api/v1`

## API areas

- **Authentication:** customer/dealer registration, login, refresh, logout and current user
- **Public marketplace:** car listing search and car details; only available cars from approved dealers are shown
- **Dealer inventory:** create/update/status/archive vehicle listings
- **Dealer images:** authenticated multipart uploads stored in MongoDB, plus public image delivery for listing galleries
- **Favourites:** add, list and remove saved vehicles
- **Enquiries:** customer enquiries and dealer inbox/status management
- **Test drives:** customer booking/cancellation and dealer response
- **Notifications:** list and mark read
- **Customer profile:** profile updates
- **Administration:** dashboard, dealer verification, vehicle moderation, user status, reports and audit logs

Vehicle image uploads accept JPG, PNG or WebP up to 10 MB per image, with at most 12 images per listing. Images are stored in MongoDB; no third-party image-storage credentials or server-local upload directory are required. Be mindful that image binaries increase database storage and outbound data usage.

Dealer and listing ownership is checked by the API. Sold vehicle records are retained; delete requests archive inventory rather than removing transaction history. Admin endpoints require the ADMIN or SUPER_ADMIN role.

## First super administrator

1. Register an account using the app.
2. Set `ADMIN_BOOTSTRAP_EMAIL` to that account's email and run `npm run admin:bootstrap` from a trusted workstation with the same MongoDB URI.
3. Remove `ADMIN_BOOTSTRAP_EMAIL` from the shell/environment after the one-time command.

The bootstrap refuses to run when an active super administrator already exists. Never commit real credentials or a `.env` file.

## Deployment configuration

Set these values in the hosting provider's environment settings:

- `MONGODB_URI`
- `JWT_ACCESS_SECRET`
- `WEB_ORIGIN`
- Optional `PORT`, `API_BASE_PATH`, `JWT_ACCESS_TTL_SECONDS`, `REFRESH_TOKEN_DAYS`

The customer app, dealer app and website should use the same deployed API base path, `/api/v1`.

- [Customer mobile app](https://github.com/NavanethaKrishnan-14/SM_Associate_Customer_mobile)
- [Dealer mobile app](https://github.com/NavanethaKrishnan-14/SM_Associate_Dealer_mobile)
- [Marketplace website and admin console](https://github.com/NavanethaKrishnan-14/SM_Associate_Dealer_web)

## Data migration note

This API now creates and reads data in MongoDB. It does **not** automatically copy existing PostgreSQL records into MongoDB. If the PostgreSQL database already contains real users, listings or enquiry history, export and import those records with ID/reference mapping before switching production traffic. Keep the old database intact until the imported record counts and end-to-end workflows are verified.
## Mobile app flow

The end-to-end mobile application journey, role permissions, screen structure, backend integration rules and release acceptance checklist are documented in [docs/MOBILE_APP_FLOW.md](docs/MOBILE_APP_FLOW.md). The screen-to-endpoint mapping, implementation sequence and identified API gaps are in [docs/MOBILE_API_IMPLEMENTATION_MAP.md](docs/MOBILE_API_IMPLEMENTATION_MAP.md).


## API documentation (Swagger / OpenAPI)

The API contract is maintained in [docs/openapi.yaml](docs/openapi.yaml) using OpenAPI 3.0, compatible with Swagger UI and Swagger Editor.

To view and try the documented endpoints:
1. Open https://editor.swagger.io/.
2. Import `docs/openapi.yaml` from this repository.
3. Replace the example server URL with your deployed backend origin followed by `/api/v1`.
4. For protected endpoints, sign in first and use the returned access token as a Bearer token.

The OpenAPI file documents the principal authentication, marketplace, dealer, customer and administration endpoints. Keep it in sync with route changes. Documentation describes the expected contract; it does not itself prove that a deployed service or its database is reachable.
