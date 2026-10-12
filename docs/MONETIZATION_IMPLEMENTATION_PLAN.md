# SM Associate Cars — Monetization Implementation Plan

Status: planning proposal; prices and payment provider are not yet production-approved.

## Product rules
- Customer: 5 successfully submitted listings per calendar month free.
- Dealer: 10 successfully submitted listings per calendar month free.
- These are monthly submission allowances, not concurrent-active-listing caps. A successful submission consumes allowance even if later sold, archived, withdrawn, or rejected. Unsubmitted drafts do not consume allowance.
- Support both monthly subscriptions and one-time extra listing packs.
- Backend is authoritative for role, quota, plan eligibility, price, payment status, and entitlements. Never trust client-supplied role, amount, or payment success.
- All plan creation, plan edits, price changes, monthly limit changes, extra-credit configuration, activation/deactivation, and unlimited-listing policy changes are ADMIN-only actions enforced by backend authorization.
- Admin is not selectable through public signup. Admin access must be granted through the trusted platform/admin provisioning flow; never allow a customer/dealer to promote themselves.
- Prices and plan entitlements must be database/admin-configurable, not hardcoded in the app.

## Suggested introductory prices (INR; editable by Admin)
| Product | Proposed price | Included submissions | Notes |
|---|---:|---:|---|
| Customer Free | ₹0/month | 5/month | Baseline |
| Customer Plus | ₹199/month | 10/month total | Subscription; total quota, not 10 extra |
| Customer extra listing | ₹99 one-time | 1 extra credit | No renewal |
| Customer extra 5-pack | ₹399 one-time | 5 extra credits | No renewal |
| Dealer Free | ₹0/month | 10/month | Baseline |
| Dealer Starter | ₹499/month | 25/month total | Small dealer |
| Dealer Growth | ₹999/month | 75/month total | Growing dealer |
| Dealer Pro | ₹1,999/month | 200 included submissions/month plus unlimited additional submissions while the Pro subscription is active | No monthly cap while subscription is active; subject to platform fair-use, fraud prevention and content policies |
| Dealer extra 10-pack | ₹299 one-time | 10 additional submissions | No renewal; for plans where extra packs apply |

These are proposed launch prices, not fixed constants. Admin must be able to create, edit, activate/deactivate, and schedule changes to plans and limits through a protected management interface. Define whether plan changes affect existing subscribers immediately or at renewal; default to preserving the current paid period's entitlement unless an explicit migration policy is approved. Keep an audit trail of who changed what and when.

For Dealer Pro, 200 is the included quota threshold, not a hard cap. Once 200 included submissions have been used during an active paid Pro period, further valid submissions remain allowed without requiring extra-credit purchases. Represent this explicitly (for example, `unlimitedAdditionalListings: true`), not by assigning an enormous numeric quota. Unlimited applies only while the paid Pro entitlement is active and valid. When the subscription expires or is cancelled at period end, follow the disclosed grace/renewal policy and then apply the user's applicable allowance. Keep abuse prevention, listing quality rules, duplicate/fraud checks, and terms enforcement in place.

Monthly subscription quotas are total quotas for that period and replace the free quota for the period; they are not added on top. Extra credits are consumed only after included quota is exhausted, except for Dealer Pro where unlimited additional submissions are included. Do not offer unlimited plans other than Dealer Pro in the initial release. Confirm applicable GST, invoice treatment, renewal, refund and cancellation terms before launch.

## Admin plan management requirements
- Add an Admin-only “Plans & Limits” screen in the Admin Dashboard.
- List plans with role scope, plan type, price, billing interval, included monthly submissions, extra credits, unlimited flag, active state, and last-updated timestamp.
- Admin can create a plan; edit name/description, role scope, price, included limit, extra-credit quantity, billing interval, and unlimited flag; activate/deactivate plans; and preview the customer-facing plan card.
- Validate prices as non-negative integer paise, currency as INR for launch, sensible limits, unique plan codes, and compatible fields (for example, unlimited additional listings is only enabled on approved plan types).
- Require confirmation for impactful changes, show whether changes affect new purchases only or existing subscribers, and record actor, before/after values, timestamp, and reason in an audit log.
- Never let plan editing retroactively alter an existing paid entitlement silently. Use versioned plan snapshots or explicit migration rules.
- Customer/dealer clients may read active plans but cannot create or mutate them. Hiding admin UI is not security; every write endpoint must enforce ADMIN authorization server-side.

## Proposed Mongoose models
- ListingPlan: code, name, description, roleScope, kind (subscription/listing_pack), amountPaise, currency INR, includedMonthlySubmissions, `unlimitedAdditionalListings` (boolean, default false), extraCredits, billingInterval, active, version, sortOrder, provider plan ID (optional), createdBy, updatedBy.
- ListingEntitlement: userId, role, planId, planVersion/snapshot, status, currentPeriodStart/End, includedLimit/Used, extraCreditsRemaining, unlimitedAdditionalListings snapshot, provider customer/subscription IDs, cancelAtPeriodEnd.
- PaymentOrder: userId, planId/version, type, amountPaise, currency, status, provider, provider order/payment IDs, idempotency key, paidAt, safe metadata. Never store card or UPI credentials.
- ListingUsage: userId, listingId, role, periodKey (YYYY-MM in Asia/Kolkata), source (free/subscription/extra_credit/unlimited_pro), createdAt; add uniqueness/idempotency guards.
- PaymentWebhookEvent: unique provider event ID, event type, timestamps, processing status and minimal safe metadata.
- AdminAuditLog: actorAdminId, action, resourceType, resourceId, before/after snapshots (sanitized), reason, createdAt, request/correlation ID.

Use atomic guarded updates and transactions where available to avoid concurrent quota/credit overspend. Production transaction design must account for MongoDB replica-set availability; otherwise use a guarded reservation/commit pattern with reconciliation. Use Asia/Kolkata for calendar-month allowance boundaries and provider billing periods for subscriptions.

## Proposed API contract
- GET /api/v1/billing/listing-quota — role, period, included limit/used/remaining, extra credits, reset date, active plan, and explicit unlimited-additional-listings flag.
- GET /api/v1/billing/plans?role=customer|dealer — active catalogue and display prices, including unlimited flag.
- POST /api/v1/billing/orders — create a server-priced order for a plan or pack; client cannot submit authoritative amount.
- POST /api/v1/billing/orders/:orderId/verify — server-side provider verification; mobile callback is not proof.
- GET /api/v1/billing/orders — authenticated order history.
- POST /api/v1/billing/subscriptions/:subscriptionId/cancel — cancellation request with explicit period-end behavior.
- POST /api/v1/billing/webhooks/:provider — verify signature using raw request bytes, enforce idempotency and process events.
- GET /api/v1/admin/plans — ADMIN-only plan catalogue including inactive plans.
- POST /api/v1/admin/plans — ADMIN-only create plan.
- PATCH /api/v1/admin/plans/:planId — ADMIN-only update plan/limits.
- POST /api/v1/admin/plans/:planId/activate and /deactivate — ADMIN-only status changes (or equivalent protected PATCH).
- GET /api/v1/admin/audit-logs?resourceType=ListingPlan — ADMIN-only audit history.

These are proposed endpoints, not claims about existing routes. Provider (for example Razorpay) is not selected. Put provider-specific calls behind a service interface.

## Listing-create enforcement
1. Authenticate; derive role and user from trusted server state.
2. Validate listing data and uploads.
3. If a valid active Dealer Pro entitlement resolves to `unlimitedAdditionalListings: true`, allow the submission without consuming monthly included quota or extra credits, while recording usage/audit data and applying all content, fraud and duplicate checks.
4. Otherwise, atomically reserve included monthly quota if available, then one extra credit if available; if neither is available return a consistent domain error such as LISTING_QUOTA_EXHAUSTED with a plan action.
5. Create listing and usage record idempotently; commit reservation, release it on known failure, and reconcile interrupted reservations.
6. Ensure retries cannot double-charge. Listing edits do not consume a new submission unless explicitly treated as a new listing.
7. Return refreshed quota, including unlimited flag, in the response.

## Implementation sequence
1. Inspect existing auth, listing-create services, models and error conventions; preserve current routes.
2. Add models, indexes, quota service and explicit unlimited entitlement handling.
3. Enforce quota across every customer/dealer listing creation path; add tests before payment integration.
4. Add plans/quota read APIs and Admin-only plan management with audit logging.
5. Integrate provider order/subscription creation, signature verification, idempotent webhooks and reconciliation.
6. Build mobile quota, plans, checkout, history and subscription states; build protected Admin plan editor in the Admin interface.
7. Test role boundaries, concurrent submissions, calendar reset, payment failure/cancel, duplicate webhooks, refunds, renewals, subscription expiry, Pro unlimited behavior, and non-admin plan-write rejection.

## Acceptance criteria
- Sixth customer and eleventh dealer free submissions are blocked in the same calendar month unless valid entitlement/credits exist.
- Dealer Pro at ₹1,999/month includes 200 submissions plus unlimited additional submissions while Pro is active; the 201st and later submissions are not blocked by quota.
- Expired/inactive Pro entitlement does not grant unlimited submissions.
- Only ADMIN can create plans or change price, limits, active state or unlimited policy; customer/dealer API attempts are denied server-side.
- Admin changes are audited, and existing paid entitlements are not silently rewritten by plan edits.
- Client manipulation cannot alter price, role, quota or payment status.
- Failed/pending/cancelled payments grant no entitlement; duplicate webhooks grant no duplicate credits.
- UI preserves listing drafts at quota exhaustion; no secrets or payment credentials are committed.
