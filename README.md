# SM Associate Cars — Backend

Production-oriented REST API foundation for the SM Associate Cars marketplace.

## Architecture
- Node.js + TypeScript + Express
- PostgreSQL + Prisma
- Zod request/environment validation
- Helmet, CORS and centralized error handling
- REST API version prefix: `/api/v1`

The customer mobile app, dealer mobile app, public website and admin dashboard will use this API. Dealer inventory ownership and listing moderation must always be enforced server-side.

## Requirements
- Node.js 22+
- PostgreSQL 15+
- npm 10+

## Local setup
1. Copy `.env.example` to `.env` and set a real `DATABASE_URL`.
2. Install dependencies: `npm install`
3. Generate Prisma Client: `npm run prisma:generate`
4. Apply migrations after confirming the database: `npm run prisma:migrate`
5. Start development server: `npm run dev`

Health check: `GET /health`  
API root: `GET /api/v1`

## Safety
- Never commit `.env`, database credentials, JWT secrets, or Cloudinary API secrets.
- Do not use a local database URL in production.
- Keep production listing visibility restricted to approved, published inventory.
- Prefer archiving cars over hard deletion so enquiry history remains intact.

## Initial implementation scope
This first commit establishes the typed server, validated configuration, health endpoints, security middleware, Prisma schema baseline, and consistent error responses. Authentication, dealer verification, inventory, image signing, enquiries and administration are to be built incrementally on top of this foundation.
