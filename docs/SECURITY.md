# Security notes

What is in place, and what still needs attention before and after launch.

## Controls implemented

**Authentication & sessions**
* Passwords hashed with **argon2id** (OWASP parameters); weak hashes are upgraded on login.
* Opaque random session tokens in **HTTP-only** cookies; only a SHA-256 hash is stored server-side, with TTL expiry. Customer and admin sessions use separate cookies; admin sessions last 12 h by default.
* Session rotation on login, logout destroys the server session, password change/reset revokes all sessions.
* Per-account lockout (5 failures → 15 min) plus per-IP rate limits on login, admin login, registration and password reset. Login errors don't reveal whether an email exists; forgot-password always returns the same response.
* Reset tokens: 32 random bytes, stored hashed, 30-minute expiry, single use.

**Authorization**
* **No public admin signup.** Public registration always creates a `customer` (any submitted `role` is ignored). Staff/admin accounts are created only by the `admin:create` CLI.
* Role-based permissions enforced on **every** admin route on the server (`server/src/lib/permissions.ts`), independent of what the UI shows. Demoting a user invalidates their admin session on the next request.
* Customers can read only their own orders. Guest order access requires an HMAC-derived, non-guessable tracking token; unknown/foreign orders return `404` (no enumeration). Token links mask contact details.

**Request safety**
* **CSRF:** signed double-submit token required on all state-changing requests; `SameSite=Lax` cookies; CORS disabled unless origins are explicitly listed.
* **Input validation:** every body/query/param is parsed with Zod schemas (unknown fields stripped). Query strings can't produce objects; bodies containing `$`/`.` keys are rejected; Mongoose `strictQuery`. Search terms are regex-escaped and length-limited.
* **Security headers** via Helmet: CSP (self + Razorpay checkout + Cloudinary images + Google Fonts), HSTS in production, `frame-ancestors 'none'`, `nosniff`, no `X-Powered-By`.
* Body size limit 200 KB (webhook 1 MB); uploads 5 MB, image type verified from magic bytes; SVG/HTML rejected.
* CSV export neutralises spreadsheet formula injection.

**Money & inventory integrity**
* Prices, discounts, shipping and totals are computed only on the server from the database; client totals are ignored (an `expectedTotal` mismatch just asks the customer to review).
* Stock decrements are atomic conditional updates inside MongoDB transactions (with a compensating fallback), so stock never goes negative under concurrent checkouts. Every change is written to an audit log.
* Coupon limits (global and per customer by email **and** phone) are enforced with atomic conditional updates and unique indexes.
* Payments are marked paid only after HMAC signature verification **and** a server-side fetch from Razorpay that checks status, order id, amount and currency. Webhooks are HMAC-verified on the raw body and deduplicated by event id. Refunds go through the Razorpay API (or are explicitly recorded as manual for COD) and are guarded against over-refunding.
* Historical order prices/totals cannot be edited through the API.
* Live Razorpay keys are refused unless `RAZORPAY_ALLOW_LIVE=true`.

**Secrets & logging**
* All credentials come from environment variables; `.env` files are git-ignored and only `.env.example` placeholders are committed. No secret is ever sent to the browser (only the Razorpay *public* key id).
* Structured logs redact cookies, authorization headers, CSRF tokens, passwords, payment signatures and tracking/reset tokens in URLs.

## Known limitations / follow-ups

* Rate-limit counters are in memory per instance — use a shared store (Redis) if you run more than one instance.
* Account lockout can be triggered by someone who knows a customer's email (a denial-of-service trade-off common to lockout). Consider CAPTCHA (e.g. Cloudflare Turnstile) on login/registration/contact if abuse appears.
* No email verification on registration; no 2FA for admin accounts yet — strongly consider adding TOTP 2FA for the owner account.
* No WhatsApp or courier API integration yet (both report "not configured").
* Policy pages (privacy, terms, returns, shipping) are sensible templates that read live store settings — have them reviewed for your business and applicable Indian law (e.g. the DPDP Act 2023 and Consumer Protection (E-Commerce) Rules 2020, which also require displaying seller name, address and grievance officer details).
* Run `npm audit` regularly and before each release.

## Reporting

Keep admin credentials out of chats and screenshots. If you suspect a leak: rotate `APP_SECRET` (signs everyone out), rotate Razorpay/Cloudinary/SMTP keys in their dashboards, and reset admin passwords with `npm run admin:create -- --email … --promote`.
