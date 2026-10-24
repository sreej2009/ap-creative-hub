# API reference

Base path: **`/api/v1`**. All request and response bodies are JSON unless noted.

## Conventions

| Topic | Rule |
|---|---|
| Money | Always **integer paise** (₹1 = 100). `29900` = ₹299. |
| Auth | HTTP-only session cookies. Customers: `aph_sid`. Staff/admin: `aph_admin_sid` (separate session, shorter lifetime). |
| CSRF | Every `POST/PUT/PATCH/DELETE` must send header `X-CSRF-Token` equal to the `aph_csrf` cookie. Get both from `GET /auth/csrf`. The Razorpay webhook is exempt (it is HMAC-signed). |
| Errors | `{ "error": { "code": "OUT_OF_STOCK", "message": "…", "details": { … }, "requestId": "…" } }`. Validation errors use `code: "VALIDATION_ERROR"` and `details` = `{ field: message }`. |
| Pagination | `?page=1&limit=20` → response `meta: { total, page, limit, pages }`. |
| Dates | ISO 8601. Admin date filters (`from`, `to`) are IST calendar days (`YYYY-MM-DD`). |
| Rate limits | General 600 req / 5 min / IP. Stricter on login (10 / 15 min), admin login (8 / 15 min), registration, password reset, checkout, coupon quotes, tracking and the contact form. `429` with `code: RATE_LIMITED`. |

Common error codes: `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `CSRF_INVALID` (403), `NOT_FOUND` (404), `VALIDATION_ERROR` (400), `CONFLICT`-family (409: `SKU_TAKEN`, `OUT_OF_STOCK`, `CART_CHANGED`, `PRICE_CHANGED`, `INVALID_TRANSITION`, …), `COUPON_*` (422), `PAYMENT_NOT_CONFIGURED` / `UPLOADS_NOT_CONFIGURED` (503), `UPSTREAM_ERROR`-family (502).

---

## Health

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | `{ status, db }`. `503` when MongoDB is down. |

## Authentication — `/auth`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/auth/csrf` | — | Sets `aph_csrf` cookie, returns `{ csrfToken }`. |
| POST | `/auth/register` | — | `{ name, email, phone?, password }`. Always creates a **customer**; any `role` field is ignored. |
| POST | `/auth/login` | — | `{ email, password }`. Customers only. Generic error for bad email/password; account locks for 15 min after 5 failures (`423 ACCOUNT_LOCKED`). |
| POST | `/auth/logout` | customer | Destroys the server-side session. |
| GET | `/auth/me` | — | `{ user }` or `{ user: null }`. |
| POST | `/auth/forgot-password` | — | `{ email }`. Same response whether or not the account exists. Token valid 30 min. |
| POST | `/auth/reset-password` | — | `{ token, password }`. Revokes all sessions. |
| POST | `/auth/change-password` | customer | `{ currentPassword, newPassword }`. Revokes other sessions. |
| POST | `/auth/admin/login` | — | Staff/admin only. Returns `{ user, permissions }`. **There is no admin registration endpoint.** |
| POST | `/auth/admin/logout` | admin | |
| GET | `/auth/admin/me` | admin | `{ user, permissions }`. |

## Storefront catalogue

| Method | Path | Notes |
|---|---|---|
| GET | `/store/settings` | Public store settings (hero, shipping, COD, returns, contact) and which payment methods are available. No secrets. |
| GET | `/home` | Homepage sections: categories, newArrivals, bestSellers (only products with real sales), featured, budgetCombos, specialOffers, hero. |
| GET | `/categories` | Active category tree with active product counts. |
| GET | `/categories/:slug` | One active category with parent/children. |
| GET | `/products` | `q, category (slug), minPrice, maxPrice (paise), inStock, onSale, featured, newArrival, attrs ("Colour:Gold,Silver\|Material:Brass"), sort (newest\|popular\|price_asc\|price_desc\|name), page, limit≤48`. Returns `items, meta, category, facets { attributes, price }`. Only active products in active categories. |
| GET | `/products/lookup?ids=a,b` | Cards for up to 100 ids (guest wishlist). Unsellable ids are dropped. |
| GET | `/products/:slug` | Product detail incl. active variants and live stock. |
| GET | `/products/:slug/related` | Up to 8 related products. |

## Cart, checkout and payments

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/cart/quote` | optional | `{ items: [{ productId, variantId?, quantity }], couponCode?, paymentMethod?, email?, phone? }` → server-priced lines (with `issue` per line), subtotal, discount, shipping, codFee, total, coupon result, available payment methods. Client prices are never accepted. |
| POST | `/checkout/orders` | optional | `{ items, customer {name,email,phone}, shippingAddress, couponCode?, paymentMethod: "razorpay"\|"cod", whatsappOptIn, customerNote?, expectedTotal?, saveAddress?, idempotencyKey }`. Re-prices, reserves stock and claims the coupon atomically. Returns `{ order, trackingToken, payment }` where `payment` holds the Razorpay Checkout options (public key id only) for online orders. Replaying the same `idempotencyKey` returns the same order. Errors: `CART_CHANGED`, `PRICE_CHANGED` (with fresh `quote`), `OUT_OF_STOCK`, `COUPON_*`, `COD_UNAVAILABLE`, `PAYMENT_NOT_CONFIGURED`, `PAYMENT_INIT_FAILED`. |
| POST | `/payments/razorpay/verify` | — | `{ orderNumber, razorpay_order_id, razorpay_payment_id, razorpay_signature }`. Verifies the HMAC signature **and** fetches the payment from Razorpay to confirm status/amount/currency before marking paid. `PAYMENT_PENDING` (409) if not yet captured. |
| POST | `/payments/razorpay/retry` | owner or token | `{ orderNumber, token? }` → Checkout options again while the reservation is still valid. |
| POST | `/payments/razorpay/webhook` | HMAC | Raw body, header `X-Razorpay-Signature`; deduplicated by `X-Razorpay-Event-Id`. Handles `payment.captured`, `payment.authorized`, `order.paid`, `payment.failed`, `refund.processed`, `refund.failed`. |

## Order tracking (guest link or signed-in owner)

| Method | Path | Notes |
|---|---|---|
| GET | `/track/:orderNumber?token=` | Owner (session) or holder of the secret token. Anyone else gets `404`. Token-link views mask email/phone and the street address. |
| POST | `/track/:orderNumber/cancel` | `{ reason, token? }`. Customers may cancel while the order is Awaiting Payment, Order Placed or Payment Confirmed. Stock and coupon use are released. |
| POST | `/track/:orderNumber/return` | `{ reason (≥10 chars), token? }`. Delivered orders within the return window. |
| POST | `/contact` | `{ name, email, phone?, subject, message }`. Stored for admins; emailed to the store if email is configured. |

## Customer account — `/account` (customer session required)

| Method | Path | Notes |
|---|---|---|
| GET / PATCH | `/account/profile` | `{ name, phone?, whatsappOptIn? }` |
| GET / POST | `/account/addresses` | Up to 10 saved addresses. |
| PUT / DELETE | `/account/addresses/:id` | |
| GET / PUT | `/account/wishlist` | PUT `{ productIds }` replaces the list (used to merge a guest wishlist). |
| GET | `/account/orders` | Paginated own orders. |
| GET | `/account/orders/:orderNumber` | Own order only (`404` otherwise). |

## Admin — `/admin` (staff/admin session required)

Every route checks a permission on the server. Roles: **admin** (all) and **staff** (no refunds, exports, coupon edits, customer status changes, settings edits, or deletes).

| Method | Path | Permission |
|---|---|---|
| GET | `/admin/dashboard?range=7\|30\|90` | dashboard:read |
| GET | `/admin/products` (`q, category, status, stock=low\|out\|in, sort, page, limit`) | products:read |
| GET | `/admin/products/:id` | products:read |
| POST | `/admin/products` | products:write |
| PUT | `/admin/products/:id` (full payload; stock of existing items is never overwritten) | products:write |
| PATCH | `/admin/products/:id/status` `{ status: draft\|active\|archived }` | products:write |
| DELETE | `/admin/products/:id` (only if never ordered — otherwise `PRODUCT_HAS_ORDERS`; archive instead) | products:delete (admin) |
| GET | `/admin/categories` | categories:read |
| POST / PUT | `/admin/categories`, `/admin/categories/:id` | categories:write |
| DELETE | `/admin/categories/:id?reassignTo=<id>` (blocked with products unless reassigned) | categories:delete (admin) |
| POST | `/admin/uploads/images` (multipart field `file`, JPEG/PNG/WebP/AVIF ≤ 5 MB, verified by magic bytes) | media:upload |
| GET | `/admin/inventory` (`q, stock, category, page`) | inventory:read |
| POST | `/admin/inventory/:productId/adjust` `{ variantId?, mode: delta\|set, quantity, reason: restock\|correction\|damaged\|lost\|other, note? }` | inventory:write |
| GET | `/admin/inventory/adjustments` (`product, reason, page`) | inventory:read |
| GET | `/admin/orders` (`q, status, paymentStatus, paymentMethod, from, to, attention, page`) | orders:read |
| GET | `/admin/orders/export` (same filters → CSV, formula-injection safe, ≤ 5,000 rows) | orders:export (admin) |
| GET | `/admin/orders/:id` (incl. payment ledger and notification log) | orders:read |
| POST | `/admin/orders/:id/status` `{ status, note?, shipment? }` (validated transitions only) | orders:write |
| PUT | `/admin/orders/:id/shipment` `{ courierName, trackingNumber, trackingUrl? }` | orders:write |
| POST | `/admin/orders/:id/notes` `{ note }` (internal) | orders:write |
| POST | `/admin/orders/:id/clear-attention` | orders:write |
| POST | `/admin/orders/:id/cancel` `{ reason }` | orders:cancel |
| POST | `/admin/orders/:id/return` `{ approve, restock, note? }` | orders:write |
| POST | `/admin/orders/:id/cod-collected` `{ reference? }` | orders:write |
| POST | `/admin/orders/:id/refunds` `{ amount?, reason }` (Razorpay; cancelled/returned only) | orders:refund (admin) |
| POST | `/admin/orders/:id/manual-refunds` `{ amount, reference }` (COD only, labelled manual) | orders:refund (admin) |
| GET | `/admin/customers` (`q, status, page`) | customers:read |
| GET | `/admin/customers/:id` | customers:read |
| PATCH | `/admin/customers/:id/status` `{ isActive }` | customers:write (admin) |
| GET | `/admin/coupons` | coupons:read |
| POST / PUT / DELETE | `/admin/coupons`, `/admin/coupons/:id` | coupons:write (admin) |
| GET | `/admin/notifications` (`status, channel, page`) | notifications:read |
| GET / PATCH | `/admin/messages`, `/admin/messages/:id` | messages:read / messages:write |
| GET | `/admin/settings` (settings + integration status, never credentials) | settings:read |
| PUT | `/admin/settings` | settings:write (admin) |

## Order status model

| From | Allowed next steps | How |
|---|---|---|
| `pending_payment` | `payment_confirmed` · `cancelled` | Verified payment only · customer/staff cancel or automatic expiry |
| `placed` (COD) | `processing` · `cancelled` | Staff · customer/staff |
| `payment_confirmed` | `processing` · `cancelled` | Staff · customer/staff (refund then required) |
| `processing` | `packed` · `cancelled` | Staff |
| `packed` | `shipped` · `processing` · `cancelled` | Staff; **shipped requires courier name + tracking number** |
| `shipped` | `out_for_delivery` · `delivered` | Staff |
| `out_for_delivery` | `delivered` | Staff |
| `delivered` | `return_requested` | Customer (within the return window) or staff |
| `return_requested` | `returned` · `delivered` (declined) | Staff return workflow (optional restock) |
| `cancelled`, `returned` | `refunded` | Refund workflow only, once fully refunded |

* `payment_confirmed` is set **only** by verified payments; `refunded` **only** when the provider (or a recorded manual COD refund) confirms the refund; `cancelled` and `returned` only through their dedicated actions (which release stock/coupons).
* Every change appends a timeline entry with timestamp, actor (system / customer / staff member) and an optional customer-visible note.
