# SM Associate Cars — MongoDB API

Shared REST API for the SM Associate Cars customer app, dealer app, public website and administrator console.

## Stack

- Node.js 22+, TypeScript and Express
- **MongoDB with Mongoose** (PostgreSQL and Prisma removed)
- Zod validation, Helmet, CORS and standardized API errors
- JWT access tokens and hashed, rotating refresh tokens
- Cloudinary-signed vehicle photo uploads
- GitHub Actions typecheck and build validation

## Local development

1. Create a MongoDB database using MongoDB Atlas or a local MongoDB server.
2. Copy `.env.example` to `.env`.
3. Set `MONGODB_URI` to your MongoDB connection string and set a strong random `JWT_ACCESS_SECRET` of at least 32 characters.
4. Set `WEB_ORIGIN` to the website origin. Add Cloudinary environment variables when enabling vehicle photo uploads.
5. Run `npm install`, then `npm run dev`.

The API connects to MongoDB before listening for requests. The connection string must point to a reachable database; production should use a managed MongoDB Atlas cluster rather than `localhost`.

Health endpoint: `GET /health`  
Versioned API root: `GET /api/v1`

## API areas

- **Authentication:** customer/dealer registration, login, refresh, logout and current user
- **Public marketplace:** car listing search and car details; only available cars from approved dealers are shown
- **Dealer inventory:** create/update/status/archive vehicle listings
- **Dealer images:** signed Cloudinary uploads and image metadata management
- **Favourites:** add, list and remove saved vehicles
- **Enquiries:** customer enquiries and dealer inbox/status management
- **Test drives:** customer booking/cancellation and dealer response
- **Notifications:** list and mark read
- **Customer profile:** profile updates
- **Administration:** dashboard, dealer verification, vehicle moderation, user status, reports and audit logs

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
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (for uploads)
- Optional `PORT`, `API_BASE_PATH`, `JWT_ACCESS_TTL_SECONDS`, `REFRESH_TOKEN_DAYS`

The customer app, dealer app and website should use the same deployed API base path, `/api/v1`.

- [Customer mobile app](https://github.com/NavanethaKrishnan-14/SM_Associate_Customer_mobile)
- [Dealer mobile app](https://github.com/NavanethaKrishnan-14/SM_Associate_Dealer_mobile)
- [Marketplace website and admin console](https://github.com/NavanethaKrishnan-14/SM_Associate_Dealer_web)

## Data migration note

This API now creates and reads data in MongoDB. It does **not** automatically copy existing PostgreSQL records into MongoDB. If the PostgreSQL database already contains real users, listings or enquiry history, export and import those records with ID/reference mapping before switching production traffic. Keep the old database intact until the imported record counts and end-to-end workflows are verified.
