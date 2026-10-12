# Mobile implementation sequence and API gap register

This file supplements MOBILE_APP_FLOW.md with an actionable screen-to-API implementation map.

## Screen-to-API mapping (existing route families reviewed in source)

| Screen / action | API route family | Notes |
| --- | --- | --- |
| Register customer | POST `/auth/register/customer` | Returns access + refresh tokens and CUSTOMER user |
| Register dealer | POST `/auth/register/dealer` | Creates Dealer profile with PENDING verification and returns session |
| Sign in | POST `/auth/login` | Identifier is phone/email; password required; role is optional CUSTOMER/DEALER |
| Restore session | GET `/auth/me` | Bearer access token |
| Refresh session | POST `/auth/refresh` | Rotates refresh token; client must persist both returned tokens |
| Sign out | POST `/auth/logout` | Revoke refresh token if supplied |
| Marketplace list | GET `/cars` | Available cars on approved dealers only; supports pagination and filters |
| Car details | GET `/cars/:id` | Available cars on approved dealers only |
| Dealer inventory | GET `/dealer/cars` | Dealer-owned vehicles and optional status filter |
| Create inventory listing | POST `/dealer/cars` | Creates DRAFT |
| Edit listing | PATCH `/dealer/cars/:id` | Listing owner checked by backend |
| Change listing state | PATCH `/dealer/cars/:id/status` | Allowed transitions enforced by backend |
| Archive inventory | DELETE `/dealer/cars/:id` | Soft archive, not hard delete |
| Upload image | POST `/dealer/cars/:carId/images` | Multipart field is `file`; JPG/PNG/WebP; 10 MB each; max 12 |
| Remove image | DELETE `/dealer/cars/:carId/images/:imageId` | Only own, editable vehicle |
| Favourites | GET/POST `/favorites`, DELETE `/favorites/:carId` | Existing route requires CUSTOMER role |
| Enquiries | POST `/enquiries`, GET `/enquiries/me` | Existing customer side requires CUSTOMER role |
| Dealer enquiry inbox | `/dealer/enquiries` | Dealer-only |
| Submit a sell-car request | `/sell-car-requests` | Customer-only; this is a request/lead, not dealer inventory |
| Customer test drives | POST/GET `/test-drives`, PATCH `/test-drives/me/:id/cancel` | Customer-only |
| Dealer test-drive inbox | `/dealer/test-drives` | Dealer-only |
| Notifications | `/notifications` | Authenticated user scope |
| Customer profile | `/users` | Customer profile routes |
| Admin | `/admin` | ADMIN/SUPER_ADMIN only |

## Known integration decisions / gaps

1. **The dealer marketplace supports browsing cars, but the current favourites and enquiry routes require CUSTOMER.** Do not show dealer-only UI that calls these endpoints until the backend intentionally supports DEALER on those operations or a dealer-specific acquisition/enquiry contract is implemented. Do not bypass the role middleware.
2. **Acquisition workflow:** current dealer inventory APIs create a new owned listing as DRAFT, but this is not a dedicated purchase/acquisition ledger. A true dealer-buy module should record source, seller/dealer, agreed purchase price, purchase date, ownership evidence/document state and eventual expenses before adding to available inventory. Implement in a deliberate API/schema change, with tests.
3. **Sale/profit records:** current listing state supports marking a vehicle SOLD and retains the car record, but this is not necessarily a complete sales transaction ledger. Add explicit Sale/Acquisition entities before reporting realized profit or accounting. Never calculate profit from listing price alone.
4. **ImageKit selection:** current backend stores binary photos in MongoDB and returns its own image-content URL. ImageKit is not wired in the backend. If changing to ImageKit, implement server-signed uploads or an API upload flow and store fileId/URL; secure deletion and migration must be planned first.
5. **Admin mobile screens:** backend admin routes exist, but public registration only supports CUSTOMER and DEALER. Admin bootstrap is a trusted CLI operation. Avoid a public Admin role card.
6. **OTP / Google / Apple login:** not established in the current backend contract; do not show a functional control for these until corresponding providers and server verification are implemented.
7. **Password reset:** do not ship a nonfunctional “Forgot password?” flow. Add one-time, expiring reset tokens and delivery provider or temporarily show a support/contact route.
8. **Phone verification / dealer document upload:** registration currently asks for phone/email/password and dealer business name/city; do not imply OTP verification or document verification is implemented when it is not.

## Implementation sequence

1. Scaffold Expo TypeScript project, strict lint/typecheck, navigation groups, design tokens, safe-area/keyboard support, common fields/buttons/status/error/empty/loading components.
2. Implement API client with typed envelopes, request timeout, access-token injection, single-flight refresh rotation, one retry maximum and logout-on-refresh-failure; use Expo SecureStore for secrets.
3. Build splash/welcome, role selector (Customer/Dealer only), sign-up forms, sign-in and current-session routing.
4. Build customer marketplace, filters/detail, favourites, enquiries, test drives, sell-car request and account.
5. Build dealer dashboard, marketplace read-only browse, dealer inventory CRUD, photo upload/reorder/cover selection, enquiries, test-drive management and profile verification state.
6. Add acquisition/sales contracts and screens only after backend models and endpoints have been specified and tested.
7. Add admin experience only if explicitly required on mobile; otherwise use the existing web admin console.
8. Execute typecheck/lint/unit/integration tests, then Android/iOS device testing and production configuration review.

## Manual acceptance matrix

- Customer can register, sign in, browse cars, favourite a car, send an enquiry, request/cancel a test drive and submit a sell request.
- Dealer can register, sign in, see pending verification, browse public cars, create/edit inventory, upload/delete photos, submit listing for review, see enquiries and answer test-drive requests.
- Dealer cannot manipulate another dealer's vehicles.
- Admin-only APIs reject CUSTOMER and DEALER even if the UI is bypassed.
- Draft/Pending/Rejected/Sold/Archived cars are not returned as available marketplace inventory.
- Refresh is single-flight and rotates both tokens once; invalid refresh clears session and doesn't retry forever.
- Every screen handles empty results, slow/offline network, timeout, malformed response, access denied, duplicate registration and validation errors.
- The app has no hard-coded secrets and no fake production listings/ratings.
