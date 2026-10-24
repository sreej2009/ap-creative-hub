# Setup guide

This guide gets A&P Creative Hub running locally, then connects each external service. Every integration is optional for local development — the app tells you clearly when something isn't configured instead of pretending it worked.

**Requirements:** Node.js 20.19+ (tested on Node 24), npm 10+.

---

## 1. Install

```bash
npm install
```

npm workspaces install both `server/` and `client/`.

## 2. Configure the server

```bash
cp server/.env.example server/.env
```

Set at least:

| Variable | What to put |
|---|---|
| `MONGODB_URI` | Your MongoDB connection string (see §3) |
| `APP_SECRET` | A long random string: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `APP_URL` | `http://localhost:5173` for local development |

Everything else has safe defaults. The full list with explanations is in `server/.env.example`. The client needs no configuration in development (`client/.env.example` explains the one optional variable).

## 3. Database

### Option A — MongoDB Atlas (recommended, also for production)

1. Create a free cluster at <https://www.mongodb.com/atlas>.
2. **Database Access** → add a database user with a strong password (role: *Read and write to any database*, or scoped to your database).
3. **Network Access** → add your IP (and later your server's outbound IP).
4. **Connect → Drivers** → copy the `mongodb+srv://…` string, insert the password, and add a database name: `…mongodb.net/ap-creative-hub?retryWrites=true&w=majority`.
5. Put it in `MONGODB_URI`.

Atlas clusters are replica sets, so multi-document **transactions are used automatically** for stock reservation, coupon claims and order creation.

### Option B — local database without installing MongoDB

```bash
npm run db:local
```

This starts a single-node replica set (transactions work exactly as on Atlas) with data stored in `server/.local-db/`. Keep it running in its own terminal and use:

```
MONGODB_URI=mongodb://127.0.0.1:27017/ap-creative-hub?replicaSet=local
```

> If you point the app at a **standalone** MongoDB (no replica set), it detects that and switches to a compensating-update fallback: every stock change is still an atomic conditional update and partial failures are rolled back by hand. Set `MONGODB_TRANSACTIONS=off` to force this mode. A replica set is still strongly recommended.

## 4. Seed categories and sample products

```bash
npm run seed
```

Creates the store settings, the 8 starter categories (Accessories & Jewellery → Clips, Chains, Earrings, Bracelets; One Gram Gold; Budget Combos; Games & Gifts) and **16 sample products**.

Sample products are clearly marked: SKUs start with `SAMPLE-`, they carry `isSample: true`, their descriptions say "Sample product", and their artwork is stamped "SAMPLE IMAGE". Before launch, archive or delete them in **Admin → Products** (search `SAMPLE`), or run `npm run seed -- --reset-samples` / `--no-samples`. The seed script refuses to run with `NODE_ENV=production` unless you pass `--force`.

## 5. First admin

There is **no public admin signup** — customer registration can never create staff. Admin and staff accounts are provisioned from the command line by someone with server access:

```bash
npm run admin:create -- --email owner@yourstore.in --name "Your Name"
```

You'll be prompted for the password twice (input hidden). Admin passwords must be at least 12 characters with upper-case, lower-case and a number. Then sign in at **`/admin/login`**.

Other forms:

```bash
# A staff member (can run orders/products/inventory; cannot refund, export, edit coupons/settings or delete)
npm run admin:create -- --email helper@yourstore.in --name "Helper" --role staff

# Promote an existing account (resets its password and signs it out everywhere)
npm run admin:create -- --email someone@yourstore.in --promote

# Non-interactive (CI / hosting shell): pass the password for this one command only
ADMIN_PASSWORD='…' npm run admin:create -- --email owner@yourstore.in --name "Your Name"
```

Run the command against the production database by executing it on the server (or with that environment's `MONGODB_URI`). Don't put `ADMIN_PASSWORD` in a persistent `.env` file.

To remove access: set the user's role back to `customer` (or delete the user) in the database; their admin session stops working on the next request.

## 6. Run it

```bash
npm run dev
```

* Storefront: <http://localhost:5173>
* Admin: <http://localhost:5173/admin>
* API: <http://localhost:4000/api/v1/health>

Vite proxies `/api` to the API, so cookies stay first-party.

Without email configured, the password-reset link is printed to the API console in development only (never in production).

---

## 7. Cloudinary (product images)

1. Sign up at <https://cloudinary.com>.
2. **Settings → API Keys**: copy *Cloud name*, *API key*, *API secret* into `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
3. Optionally change `CLOUDINARY_FOLDER` (default `ap-creative-hub`).
4. Restart the API. **Admin → Settings → Integrations** should show Cloudinary as *Configured*.

How uploads behave:

* Only staff can upload. Files must be JPEG/PNG/WebP/AVIF ≤ 5 MB; the real type is checked from the file's bytes, not its name.
* Uploads are tracked as *temporary* until the product/category is saved. Images removed from a product are deleted from Cloudinary after the save succeeds. A cleanup job deletes uploads that were never attached after 24 hours.
* Products only accept images from **your** Cloudinary cloud (or the bundled `/samples/` art).
* Without Cloudinary, the upload button shows "Image uploads are not configured" — nothing is faked.

## 8. Razorpay (test mode)

Start in **test mode**. Live mode stays disabled until you deliberately enable it (see `docs/DEPLOYMENT.md`).

1. Sign up at <https://dashboard.razorpay.com> and switch the dashboard to **Test Mode**.
2. **Account & Settings → API Keys → Generate Test Key**. Put the values in `RAZORPAY_KEY_ID` (`rzp_test_…`) and `RAZORPAY_KEY_SECRET`.
3. **Webhooks → Add New Webhook**
   * URL: `https://<your-public-host>/api/v1/payments/razorpay/webhook` (for local testing expose the API with a tunnel such as `cloudflared tunnel --url http://localhost:4000` or `ngrok http 4000`)
   * Secret: generate a random string and put the same value in `RAZORPAY_WEBHOOK_SECRET`
   * Events: `payment.captured`, `payment.authorized`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`
4. Restart the API. Checkout now offers **Pay online (test mode — no real money is charged)**.
5. Pay with Razorpay's documented test cards/UPI IDs (see Razorpay docs → *Test Card Details*).

How payment confirmation works (and what it never does):

* The Razorpay order is created by **our server** with the server-computed total.
* After checkout the browser sends the signed response; the server verifies the **HMAC signature** and then **fetches the payment from Razorpay** to confirm it is captured, belongs to this order, and matches the amount. The frontend's word alone never marks an order paid.
* Webhooks are verified with HMAC-SHA256 over the raw body and deduplicated by event id, so repeated deliveries are harmless.
* Unpaid online orders hold stock for `RESERVATION_MINUTES` (default 30). A background job then asks Razorpay whether a payment succeeded (in case a webhook was missed) and otherwise cancels the order and releases the stock — exactly once.
* A payment arriving after expiry reinstates the order if stock is still available; otherwise (or if the customer had cancelled) the order is flagged **Needs attention → refund required**.
* Card numbers, CVVs and UPI PINs never touch this server.

Without keys, online payment is shown as unavailable with the message "Online payment is not configured yet", and the API returns `503 PAYMENT_NOT_CONFIGURED`.

## 9. Email (optional)

Any SMTP provider works (Brevo, Amazon SES, Postmark, Resend SMTP, Zoho, …):

```
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=…
SMTP_PASS=…
EMAIL_FROM="A&P Creative Hub <orders@yourdomain.in>"
```

Verify your sending domain (SPF/DKIM) with the provider so emails don't land in spam. Emails sent: order confirmation (COD), payment confirmation (online), shipped, out for delivery / delivered, cancellation, refund, password reset, and contact-form messages to the store's support email (**Admin → Settings → Contact**).

Every attempt is logged in **Admin → Notifications** as `sent`, `failed` or `skipped` (with the reason). Nothing is reported as sent unless the provider accepted it.

## 10. WhatsApp and courier tracking

* **WhatsApp:** the notification service has a WhatsApp channel, but no provider is integrated. Messages are only ever attempted for customers who opted in at checkout; until a WhatsApp Business API provider (e.g. Meta Cloud API, Gupshup, Interakt) with approved templates is connected in `server/src/integrations/email.ts` (`WhatsAppTransport`), they are logged as `skipped`.
* **Courier tracking:** staff enter the courier name, AWB and tracking link manually. The order model has a `courierEvents` list that is shown to customers **only** when populated by a verified integration; none is connected yet, so no scans are invented.

## 11. Store settings

**Admin → Settings** (admins only) controls the announcement bar, homepage hero, flat shipping fee and free-shipping threshold, COD on/off + fee + maximum order value, the return window, and contact/social links (support email, phone, WhatsApp number with country code, Instagram URL). Shipping, COD and returns copy on the storefront and policy pages update automatically.

## 12. Tests

```bash
npm test                 # server + client
npm test -w server       # API/integration tests (in-memory MongoDB replica set)
npm test -w client       # unit/component tests (jsdom)
```

All payment-provider, Cloudinary and email interactions in automated tests are **mocked**; signatures are computed with real HMAC using test-only secrets. No test calls a real external service. The first server test run downloads a MongoDB binary (~100 MB) for `mongodb-memory-server`.
