# SM Associate Cars — Monetization Implementation Plan

Status: planning proposal; prices and payment provider are not yet production-approved.

## Product rules
- Customer: 5 successfully submitted listings per calendar month free.
- Dealer: 10 successfully submitted listings per calendar month free.
- These are monthly submission allowances, not concurrent-active-listing caps. A successful submission consumes allowance even if later sold, archived, withdrawn, or rejected. Unsubmitted drafts do not consume allowance.
- Support both monthly subscriptions and one-time extra listing packs.
- Backend is authoritative for role, quota, plan eligibility, price, payment status, and entitlements. Never trust client-supplied role, amount, or payment success.
- Prices and plan entitlements must be database/admin-configurable, not hardcoded in the app.

## Suggested introductory prices (INR)
| Product | Proposed price | Included submissions | Notes |
|---|---:|---:|---|
| Customer Free | ₹0/month | 5/month | Baseline |
| Customer Plus | ₹199/month | 10/month total | Subscription; total quota, not 10 extra |
| Customer extra listing | ₹99 one-time | 1 extra credit | No renewal |
| Customer extra 5-pack | ₹399 one-time | 5 extra credits | No renewal |
| Dealer Free | ₹0/month | 10/month | Baseline |
| Dealer Starter | ₹499/month | 25/month total | Small dealer |
| Dealer Growth | ₹999/month | 75/month total | Growing dealer |
| Dealer Pro | ₹1,999/month | 200/month total | High-volume dealer |
| Dealer extra 10-pack | ₹299 one-time | 10 extra credits | No renewal |

Monthly subscription quotas are total quotas for that period and replace the free quota for the period; they are not added on top. Extra credits are consumed only after included quota is exhausted. Do not offer unlimited plans in the initial release. Prices are proposals for business review; confirm applicable GST, invoice treatment, renewal, refund and cancellation terms before launch.

## Proposed Mongoose models
- ListingPlan: code, name, role scope, kind (subscription/listing_pack), amountPaise, currency INR, includedMonthlySubmissions, extraCredits, billingInterval, active, sortOrder, description, optional provider plan ID.
- ListingEntitlement: userId, role, planId, status, currentPeriodStart/End, includedLimit/Used, extraCreditsRemaining, provider customer/subscription IDs, cancelAtPeriodEnd.
- PaymentOrder: userId, planId, type, amountPaise, currency, status, provider, provider order/payment IDs, idempotency key, paidAt, safe metadata. Never store card or UPI credentials.
- ListingUsage: userId, listingId, role, periodKey (YYYY-MM in Asia/Kolkata), source (free/subscription/extra_credit), createdAt; add uniqueness/idempotency guards.
- PaymentWebhookEvent: unique provider event ID, event type, timestamps, processing status and minimal safe metadata.

Use atomic guarded updates and transactions where available to avoid concurrent quota/credit overspend. Production transaction design must account for MongoDB replica-set availability; otherwise use a guarded reservation/commit pattern with reconciliation. Use Asia/Kolkata for calendar-month allowance boundaries and provider billing periods for subscriptions.

## Proposed API contract
- GET /api/v1/billing/listing-quota — role, period, included limit/used/remaining, extra credits, reset date and active plan.
- GET /api/v1/billing/plans?role=customer|dealer — active catalogue and display prices.
- POST /api/v1/billing/orders — create a server-priced order for a plan or pack.
- POST /api/v1/billing/orders/:orderId/verify — server-side provider verification; mobile callback is not proof.
- GET /api/v1/billing/orders — authenticated order history.
- POST /api/v1/billing/subscriptions/:subscriptionId/cancel — cancellation request with explicit period-end behavior.
- POST /api/v1/billing/webhooks/:provider — verify signature using raw request bytes, enforce idempotency and process events.
- Admin-only plan management endpoints with authorization and audit logging.

Provider (for example Razorpay) is not selected. Put provider-specific calls behind a service interface. These are proposed endpoints, not claims about existing routes.

## Listing-create enforcement
1. Authenticate; derive role and user from trusted server state.
2. Validate listing data and uploads.
3. Atomically reserve included monthly quota if available, otherwise one extra credit; if neither is available return a consistent domain error such as LISTING_QUOTA_EXHAUSTED with a plan action.
4. Create listing and usage record idempotently; commit reservation, release it on known failure, and reconcile interrupted reservations.
5. Ensure retries cannot double-charge. Listing edits do not consume a new submission unless explicitly treated as a new listing.
6. Return refreshed quota in the response.

## Implementation sequence
1. Inspect existing auth, listing-create services, models and error conventions; preserve current routes.
2. Add models, indexes and quota service.
3. Enforce quota across every customer/dealer listing creation path; add tests before payment integration.
4. Add plans/quota read APIs.
5. Integrate provider order/subscription creation, signature verification, idempotent webhooks and reconciliation.
6. Build mobile quota, plans, checkout, history and subscription states.
7. Add admin plan management, audit log and webhook-failure monitoring.
8. Test role boundaries, concurrent submissions, calendar reset, payment failure/cancel, duplicate webhooks, refunds, renewals and retries.

## Acceptance criteria
- Sixth customer and eleventh dealer free submissions are blocked in the same calendar month unless a valid paid entitlement or extra credit exists.
- Client manipulation cannot alter price, role, quota or payment status.
- Failed/pending/cancelled payments grant no entitlement; duplicate webhooks grant no duplicate credits.
- Pack purchase grants exactly configured credits once; subscription renewal grants the correct period quota once.
- UI preserves listing drafts at quota exhaustion; no secrets or payment credentials are committed.
