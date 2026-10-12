# SM Associate Cars — Mobile App Flow & Backend Contract

This document defines the end-to-end product flow for the SM Associate Cars Android/iOS app and its shared API.

## Repository status (reviewed 2026-10-12)

- `SM_Associate_Dealer_Mobile`: currently empty on GitHub's `main` branch. The mobile app needs to be initialized and committed before individual screens can be implemented.
- `SM_Associate_Dealer_backend`: contains an Express + TypeScript + MongoDB API with authentication, public car browsing, dealer-owned inventory, image upload/delivery, favourites, enquiries, sell-car requests, test drives, notifications, profile and admin routes.
- Current backend image storage uses MongoDB `CarImage` records, not ImageKit. Keep this consistent until a deliberate migration is planned.
- API base path: `/api/v1`. Health check: `GET /health`.

## Product rules

1. Customer and Dealer are public signup roles. Admin is never selectable in public signup.
2. Customer can browse/buy cars and create a sell-car request for personally owned vehicles.
3. Dealer can acquire/buy vehicles, manage commercial inventory, and sell cars. Dealer acquisition/financial accounting is a separate workflow from merely enquiring about a marketplace listing; do not treat an enquiry as a completed purchase.
4. Dealer accounts begin with `verificationStatus=PENDING`. The UI should allow onboarding and indicate limited/pending status. Public vehicle listing visibility must follow backend approval.
5. Admin permissions are assigned through a trusted bootstrap/admin process and checked by the API on every protected endpoint.
6. Roles/IDs/prices/statuses are validated by the backend. The client may hide disallowed buttons, but client-side checks never replace API authorization.
7. Use a shared API contract and common DTOs. Do not assume a route exists until confirmed in the backend.
8. The client must show loading, empty, error/retry and success states for all API-driven screens.

## End-to-end journey

### First launch
Splash -> onboarding/welcome -> Get Started or Sign In.

### Sign up
Choose Customer or Dealer -> enter details -> validate -> call backend registration -> save returned access/refresh tokens securely -> load returned user/role -> route to the correct dashboard.

- Customer registration: `POST /api/v1/auth/register/customer` with `name, phone, email?`, and `password`.
- Dealer registration: `POST /api/v1/auth/register/dealer` with those fields plus `businessName, city`.
- Registration returns a session. Do not ask the user to register then log in again unless the API contract changes.
- Admin signup is not supported.

### Sign in / session
Sign-in screen accepts phone or email + password and selected account context Customer/Dealer (optional role in request). Call `POST /api/v1/auth/login` with `identifier, password, role?`. Save `accessToken` and `refreshToken` securely; use `Authorization: Bearer <accessToken>`. At startup call `GET /api/v1/auth/me` to restore the authenticated user when a valid session is available. On a 401, try `POST /api/v1/auth/refresh` once, replace both tokens, retry original request once; if refresh fails, clear session and route to Sign In. Logout with `POST /api/v1/auth/logout`, then clear local secure storage. Avoid infinite retry loops.

### Customer dashboard
Bottom navigation: Home, Explore, Sell, Favourites, Account.

- Home/Explore: query available marketplace cars; filter/search by brand, model, price range, year, mileage, fuel, transmission, city and sort.
- Car details: gallery, specs, price, seller/dealer info where returned, favourite action, enquiry and test-drive CTA.
- Favourites: list/add/remove user's favourites.
- Enquiries: create enquiry from a car and display its current status.
- Test drives: submit preferred date/time and view/cancel pending bookings.
- Sell: create a sell-car request for an individually owned car; show submitted/review/contact status. This is not the same as a dealer adding inventory.
- Account: profile, notifications, privacy/help, logout.

### Dealer dashboard
Bottom navigation: Dashboard, Buy Cars, Inventory, Enquiries, Test Drives, Profile (adjust to compact tab bar plus “More” menu as needed).

- Buy Cars: browse marketplace and contact sellers using enquiry flow; dealer can negotiate/acquire a car externally and then record/add it to owned inventory with provenance/documents as product functionality is implemented.
- Inventory: list/create/edit/submit/mark reserved/mark sold/archive own dealership vehicles. Ownership filter is mandatory. New car starts as DRAFT; add photos; submit as PENDING_APPROVAL; public listing appears only after approval as AVAILABLE.
- Purchases: record acquired vehicles, purchase date/price, source seller, ownership/document checklist and expenses; do not infer purchase from an enquiry or reservation.
- Enquiries: review leads for the dealer's listings and update allowed statuses.
- Test drives: respond to requests and track booking status.
- Dashboard/reporting: inventory counts, enquiries, test drives, sold stock and financial KPIs only where supported by persisted backend data.
- Dealer profile: business details and verification status; clearly label Pending/Verified/Rejected.
- Sold/archived records retain history; avoid destructive delete UX.

### Admin console / admin entry
Admin is provisioned by trusted server bootstrap, not self-selected at signup. Admin views include dashboard, dealer verification, listing moderation, user status management, reports/complaints and audit activity. Enforce ADMIN/SUPER_ADMIN server-side on every admin route. Admin access is not to be placed among public role cards; a separate private route/login context may be used if desired.


## Listing limits and paid listing plans

### Recommended initial policy (business rule; prices still to be decided)

- **Customer:** up to 5 active personal-car listings free.
- **Dealer:** up to 15 active inventory listings free. This chooses the top end of the proposed 10–15 range to give dealers enough room to start using the marketplace.
- When a role reaches its active-listing allowance, show a clear limit screen with the current count, allowance, plan/credit options and a link to manage listings. Do not silently charge the user.
- Count only listings in active marketplace lifecycle states (for example `PENDING_APPROVAL`, `AVAILABLE`, `RESERVED`). Do not count drafts that were never submitted, sold, archived, withdrawn or expired listings. Confirm the exact states in the backend quota service and make this definition consistent across mobile and web.
- Deleting/archiving or marking a car sold must not erase transaction/audit history. Do not allow repeated status toggles to bypass quotas.
- Customers and dealers must see their remaining free listing allowance before starting a new listing. Enforce the quota on the server during listing creation/submission; UI-only limits are not secure.
- A paid plan can increase the number of concurrent active listings or provide listing credits. Present the plan's price, duration, allowance, taxes (if applicable), renewal/cancellation terms and payment status before checkout. Never advertise a price until the business has approved it.
- Payment success must be verified server-to-server using a signed provider webhook or equivalent verified callback before activating paid entitlements. A client-side “payment successful” screen alone must never grant listings.
- Handle pending, failed, cancelled, refunded, expired and duplicate payment events idempotently. Do not consume a paid credit twice for retried requests.
- Keep plan/entitlement records and payment references in the backend; never store card/UPI credentials in the app. Add admin views for plan configuration, payment/entitlement history and support/refund review.
- Decide whether paid access is a recurring subscription, a one-time pack of extra active slots, or both before implementing checkout. For an initial launch, extra-slot packs are operationally simpler; recurring subscriptions can be added when the pricing and renewal policy are clear.

### Listing creation journey with quota

Customer/Dealer taps “Sell/Add Car” -> app fetches quota/entitlements -> show used/free/paid slots -> user completes vehicle form and photos -> server checks quota and role -> if allowance remains, save draft and allow submission -> if limit reached, explain options and route to plan/slot purchase -> verify payment on backend -> refresh entitlements -> allow listing creation/submission -> moderation -> publish only when the dealer and listing are approved.

### Required screens

- Listing usage in the Sell/Inventory area: `4 of 5 free listings used`, or `12 of 15 free listings used` (example copy only).
- Limit reached screen with available plans/slot packs, clear pricing and checkout.
- Payment pending/success/failure/cancelled states and a “Check payment status” retry.
- Plan/entitlement history and expiry/renewal information where relevant.
- Admin plan configuration and payment support/audit screens.

## UI and design direction

- Premium automotive identity: midnight navy/charcoal, warm ivory, restrained champagne-gold highlights.
- Genuine vehicle photos; consistent image aspect ratios; clear prices and vehicle specs.
- Reusable components: Button, TextField, PasswordField, RoleCard, CarCard, FilterSheet, EmptyState, ErrorState, LoadingSkeleton, StatusBadge, ConfirmDialog.
- No clipped layouts on small Android devices; respect safe areas, keyboard avoiding, accessibility labels, minimum tap targets and dynamic text.
- Forms should preserve inputs on retry. Disable submit during requests, validate both client-side and server-side, and show concise field-level API errors.
- Avoid fabricated metrics, fake ratings, fabricated verification badges, and fake available inventory in production.

## Backend integration checklist

Use the API's actual response envelope: generally `{ success, data, error? }`. Confirm every endpoint/method and DTO before wiring the screen. Main endpoint families currently mounted by the backend include:

- `/auth`: register customer/dealer, login, refresh, logout, me
- `/cars`: public browse/detail
- `/dealer/cars`: dealer inventory CRUD/status
- `/dealer/cars` image routes: authenticated upload/public image delivery
- `/favorites`
- `/enquiries`, `/dealer/enquiries`
- `/sell-car-requests`
- `/test-drives`, `/dealer/test-drives`
- `/notifications`
- `/users` customer profile
- `/admin`

Verify the mobile-specific CORS/origin strategy: React Native native calls do not normally use browser CORS, but web origins should remain explicitly configured. Do not loosen CORS to `*` with credentials.

## Security requirements

- Keep access/refresh tokens in platform secure storage (e.g. Expo SecureStore), never plain AsyncStorage.
- Do not bundle MongoDB, JWT or image-hosting secrets in the app.
- Validate uploads by MIME signature, size and count server-side; avoid exposing sensitive documents in public image routes.
- Apply role + resource-ownership checks on API operations; enforce dealer verification policy on publishing/sales features.
- Avoid logging passwords, tokens, identity documents, or private user data.
- Add unit/integration tests for auth, role boundaries, car status transitions, listing visibility, upload failures, refresh rotation and account deletion/archiving policies.

## Release and QA acceptance checklist

- Register Customer; session is returned; app lands on Customer Home.
- Register Dealer; dealer profile shows Pending; app lands on Dealer Dashboard.
- Login as Customer cannot open dealer inventory or admin endpoints.
- Login as Dealer can buy/browse and manage only that dealer's stock.
- Admin is not selectable publicly; non-admin receives 403 for admin routes.
- App restores session, refreshes expired access tokens once, and logs out cleanly.
- Public browse never shows Draft, Pending, Rejected, Archived or Sold as available.
- Image upload and gallery work over production HTTPS and failure states are visible.
- Empty marketplace, no favourites, no enquiries and no inventory show a friendly empty state.
- Test on small Android devices and iOS, keyboard, offline/slow network, API timeout and malformed API responses.
- CI runs lint/typecheck/tests/build; verify production env vars and health route before store builds.
