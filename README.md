# SM Associate Cars — Marketplace API

Shared REST API for the SM Associate Cars customer app, dealer app, public website and administrator console.

## Stack

- Node.js 22+, TypeScript and Express
- PostgreSQL with Prisma ORM
- Zod validation, Helmet security headers, CORS and standardized error responses
- JWT access tokens with hashed, rotating refresh tokens
- Cloudinary-signed uploads for vehicle photos
- GitHub Actions validation of the Prisma schema and TypeScript build

## Local development

Requirements: Node.js 22+, npm 10+, PostgreSQL 15+.

1. Copy `.env.example` to `.env`.
2. Set `DATABASE_URL` to a PostgreSQL database you control. Set a strong random `JWT_ACCESS_SECRET` of at least 32 characters.
3. Configure `WEB_ORIGIN` for your local website origin. Add Cloudinary values when enabling image uploads.
4. Run `npm install`.
5. Run `npm run prisma:generate`.
6. Run `npm run prisma:migrate` to create/apply the initial migration against the configured development database.
7. Run `npm run dev`.

Health endpoint: `GET /health`  
Versioned API root: `GET /api/v1`

**Database migration note:** the Prisma schema is committed, but a generated SQL migration has not yet been committed. Connect a development PostgreSQL database and run `npm run prisma:migrate`; review and commit the resulting `prisma/migrations` directory before running `npm run prisma:deploy` in production. Do not point the development migration command at your production database.

## Implemented API areas

- **Authentication:** `POST /api/v1/auth/register/customer`, `POST /api/v1/auth/register/dealer`, `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`
- **Public marketplace:** `GET /api/v1/cars`, `GET /api/v1/cars/:id`. Filters include query, city, brand, model, price range, year, fuel type, transmission and sort. Only published cars from approved dealers are returned.
- **Dealer inventory:** `GET/POST /api/v1/dealer/cars`, `PATCH /api/v1/dealer/cars/:id`, `PATCH /api/v1/dealer/cars/:id/status`, `DELETE /api/v1/dealer/cars/:id`
- **Dealer images:** `POST /api/v1/dealer/cars/:id/images/signature`, `POST /api/v1/dealer/cars/:id/images`, `DELETE /api/v1/dealer/cars/:id/images/:imageId`
- **Favourites:** `GET/POST /api/v1/favorites`, `DELETE /api/v1/favorites/:carId`
- **Enquiries:** `POST /api/v1/enquiries`, `GET /api/v1/enquiries/me`, `GET /api/v1/dealer/enquiries`, `PATCH /api/v1/dealer/enquiries/:id`
- **Test drives:** `POST /api/v1/test-drives`, `GET /api/v1/test-drives/me`, `PATCH /api/v1/test-drives/me/:id/cancel`, `GET /api/v1/dealer/test-drives`, `PATCH /api/v1/dealer/test-drives/:id`
- **Notifications:** `GET /api/v1/notifications`, `PATCH /api/v1/notifications/:id/read`, `PATCH /api/v1/notifications/read-all`
- **Customer profile:** `PATCH /api/v1/users/me`
- **Administration:** `GET /api/v1/admin/dashboard`, dealer verification, pending-car moderation, user status management, reports and audit logs.

All dealer inventory changes are checked server-side against the authenticated dealer profile. Car deletion archives the listing instead of deleting business history. The admin API is restricted to `ADMIN` or `SUPER_ADMIN` roles.

## First super administrator

1. Register an account through the customer registration endpoint using the administrator's intended email address.
2. With the correct database selected, set `ADMIN_BOOTSTRAP_EMAIL` to that account's email and run `npm run admin:bootstrap` once.
3. Remove `ADMIN_BOOTSTRAP_EMAIL` from the shell/environment immediately after the command completes.

This one-time command refuses to run if an active super administrator already exists. Keep database credentials private and run it only from a trusted administrator workstation or deployment console.

## Deployment configuration

Set the real environment variables in the hosting provider's secret/environment settings. Never commit a real `.env` file, passwords, JWT secrets, database credentials or Cloudinary API secrets. Production must use a managed PostgreSQL URL—not `localhost`—and the production frontend origin in `WEB_ORIGIN`.

The mobile apps and website use the same API base path: `/api/v1`. See the corresponding repository READMEs:

- [Customer mobile app](https://github.com/NavanethaKrishnan-14/SM_Associate_Customer_mobile)
- [Dealer mobile app](https://github.com/NavanethaKrishnan-14/SM_Associate_Dealer_mobile)
- [Marketplace website and admin console](https://github.com/NavanethaKrishnan-14/SM_Associate_Dealer_web)

## Current release status

This is an actively developed foundation, not yet a production deployment. Generate and review the database migration, configure hosted PostgreSQL and Cloudinary, run the mobile apps on actual devices, verify complete user journeys and security settings, then deploy. No credentials or production URLs are included in the repository.
