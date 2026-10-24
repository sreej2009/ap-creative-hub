# A&P Creative Hub

E-commerce platform for A&P Creative Hub — jewellery, one-gram gold, hair accessories, budget combos, games and gifts — with a customer storefront and a protected admin dashboard.

**Stack:** React 19 · Vite 8 · TypeScript · Tailwind CSS 4 · React Router 8 · TanStack Query · React Hook Form + Zod — Node.js · Express 5 · MongoDB (Mongoose 9) · Zod — Razorpay · Cloudinary · SMTP email.

## Quick start

```bash
npm install
cp server/.env.example server/.env        # set MONGODB_URI and APP_SECRET (see docs/SETUP.md)
npm run db:local                          # optional: local MongoDB replica set, in its own terminal
npm run seed                              # categories + clearly marked SAMPLE products
npm run admin:create -- --email you@example.com --name "Your Name"
npm run dev                               # storefront http://localhost:5173, admin /admin
```

| Command | What it does |
|---|---|
| `npm run dev` | API (watch mode, :4000) + storefront (Vite, :5173) |
| `npm run build` | Type-checks and builds `server/dist` and `client/dist` |
| `npm start` | Runs the built API (serves the storefront too when `SERVE_CLIENT=true`) |
| `npm test` | Server integration tests + client unit tests |
| `npm run typecheck` | TypeScript checks for both packages |
| `npm run seed` | Store settings, categories, sample catalogue (`--reset-samples`, `--no-samples`) |
| `npm run admin:create -- …` | Provision an admin/staff account (the only way to create one) |
| `npm run db:local` | Local single-node MongoDB replica set in `server/.local-db/` |

## Go live (Render + MongoDB Atlas, free tiers)

1. Create a free MongoDB Atlas cluster and copy its connection string (see `docs/SETUP.md` §3). In Atlas **Network Access**, allow `0.0.0.0/0` (Render's free tier has no fixed IP).
2. On <https://render.com>: **New → Blueprint** → select this repository → paste the Atlas string into `MONGODB_URI` → **Apply**. `render.yaml` sets everything else.
3. When the deploy is green, set `APP_URL` to your Render URL (e.g. `https://ap-creative-hub.onrender.com`).
4. From your computer, using the Atlas string as `MONGODB_URI`: `npm run seed -- --force` (optional sample catalogue) and `npm run admin:create -- --email you@… --name "…"`.

Razorpay, Cloudinary and email can be added later as environment variables — the store runs without them (COD only, no uploads, emails logged as skipped).

## What's included

**Storefront** — home (hero, shop by category, new arrivals, best sellers, featured, budget combos, offers, Instagram/WhatsApp), shop/category/search with filters (category, price, availability, attributes), sorting and pagination, product pages with galleries, variants and stock-aware quantity, wishlist (device + account sync), cart drawer and cart page, checkout (guest or signed-in, saved addresses, coupons, COD, Razorpay), order confirmation and tracking (signed-in or secure link), cancellations and return requests, registration/login/password reset, profile, address book and order history, contact form, FAQ and policy pages.

**Motion** — the homepage hero and "Shop by category" use lightweight 2.5D depth (no animation libraries): layered SVG artwork with mouse parallax and a gentle tilt, floating jewellery, a masked champagne light sweep, staggered entrances, and perspective-tilt category cards on desktop. Touch devices get only the gentle float and entrances; `prefers-reduced-motion` turns motion off entirely. See `client/src/components/store/HeroArt.tsx`, `CategoryArchCard.tsx` and `client/src/hooks/useMotion.ts`.

**Admin** — dashboard from live data (net sales from verified payments, orders, pipeline, low stock, recent orders, daily sales/orders charts, top products), orders (search, filters, CSV export, validated status changes, courier tracking, internal notes, cancellation, returns, Razorpay refunds, COD collection and manual COD refunds, payment ledger, notification log), products (CRUD, image upload/reorder/alt text, variants, attributes, draft/active/archived, safe delete), categories (nesting, ordering, activation, reassign-before-delete), inventory (adjustments with reasons, history, low/out-of-stock), customers (search, details, order history, disable), coupons, contact messages, notification log, store settings with integration status. Two roles: **admin** and **staff**.

**Integrity & security** — server-side pricing, atomic stock reservation in transactions (no overselling under concurrency), reservation expiry with payment reconciliation, idempotent checkout and webhooks, HMAC-verified payments, argon2id passwords, server-side sessions, CSRF protection, RBAC on every admin route, rate limiting, security headers, input validation everywhere. Details in [`docs/SECURITY.md`](docs/SECURITY.md).

## Project layout

```
client/                 React storefront + admin (Vite)
  src/components/       ui/ (design system), store/, admin/
  src/pages/            store/, account/, admin/ (admin is lazy-loaded)
  src/hooks, src/lib    API client, cart/wishlist/auth state, formatting
  public/samples/       placeholder artwork for SAMPLE products
server/                 Express API
  src/models/           Mongoose models
  src/services/         business logic (checkout, inventory, payments, fulfilment, …)
  src/routes/           thin HTTP layer (auth, store, admin)
  src/schemas/          Zod request schemas
  src/integrations/     Razorpay, Cloudinary, email adapters
  src/jobs/             reservation expiry, image cleanup
  src/scripts/          seed, create-admin, local-db
  tests/                integration tests (in-memory MongoDB replica set, mocked providers)
docs/                   SETUP, API, DEPLOYMENT, SECURITY
```

## Documentation

* [`docs/SETUP.md`](docs/SETUP.md) — database, Cloudinary, Razorpay test mode, email, first admin, seeding, tests
* [`docs/API.md`](docs/API.md) — every endpoint, error format, order status model
* [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — production build, hosting, Razorpay go-live checklist, backups and recovery
* [`docs/SECURITY.md`](docs/SECURITY.md) — controls in place and known limitations

## Status

Feature-complete for an initial launch and covered by automated tests, but **not yet production-ready**: Razorpay, Cloudinary and email must be configured with real accounts and verified end-to-end on the deployed site, live payments must be explicitly enabled by the owner, and the policy pages need review. WhatsApp messaging and courier-API tracking are not integrated (both report "not configured" rather than pretending). See the go-live checklist in `docs/DEPLOYMENT.md`.
