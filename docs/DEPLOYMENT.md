# Deployment, go-live and operations

## Recommended shape

One Node.js service that serves both the API and the built storefront from the same origin (`SERVE_CLIENT=true`). Same-origin keeps cookies first-party (`SameSite=Lax`), needs no CORS and is the simplest secure setup. MongoDB Atlas holds the data; Cloudinary holds images.

```
Browser ──HTTPS──► Host / reverse proxy ──► Node (Express)  ──► MongoDB Atlas
                                              ├─ /api/v1/*        ├─► Razorpay API
                                              └─ client/dist (SPA)└─► Cloudinary, SMTP
```

## Build and start

```bash
npm ci --include=dev     # build tools are devDependencies
npm run build            # server → server/dist, client → client/dist
npm start                # node server/dist/index.js (run from the repo root)
```

`npm test` should pass before every deploy.

## Production environment

Set these on the host (never commit them). Start from `server/.env.example`.

| Variable | Production value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | whatever the host provides |
| `MONGODB_URI` | Atlas connection string for the production database |
| `APP_SECRET` | a new random 48+ byte secret (different from development) |
| `APP_URL` | `https://yourdomain.in` |
| `SERVE_CLIENT` | `true` |
| `CLIENT_DIST_DIR` | `../client/dist` (default; relative to `server/`) |
| `TRUST_PROXY` | `1` behind one proxy/load balancer (Render, Railway, Nginx), so rate limits see real client IPs |
| `COOKIE_SECURE` | `true` (default in production) |
| `COOKIE_SAMESITE` | `lax` for same-origin. Use `none` only if the client is on a different site (then also set `CORS_ORIGINS` and the client's `VITE_API_URL`). |
| `CLOUDINARY_*` | production Cloudinary credentials |
| `RAZORPAY_*` | **test keys first** — see the go-live checklist |
| `SMTP_*`, `EMAIL_FROM` | your email provider |
| `RUN_JOBS` | `true` (safe on several instances; every job step is an atomic conditional update) |

## Host examples

**Render / Railway / Fly (managed):**
* Build command: `npm ci --include=dev && npm run build`
* Start command: `npm start`
* Health check path: `/api/v1/health`
* Add the environment variables above; add your custom domain (HTTPS is automatic).
* Allow the host's outbound IPs in Atlas **Network Access** (or use Atlas private networking where available).

**VPS (Ubuntu) with PM2 + Nginx:**

```bash
git clone … && cd ap-creative-hub
npm ci --include=dev && npm run build
cp server/.env.example server/.env   # fill in production values, chmod 600
npm i -g pm2 && pm2 start "npm start" --name ap-creative-hub && pm2 save && pm2 startup
```

```nginx
server {
  server_name yourdomain.in;
  client_max_body_size 6m;            # image uploads are capped at 5 MB
  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
# then: sudo certbot --nginx -d yourdomain.in   and set TRUST_PROXY=1
```

After deploying: create the first admin on the server (`npm run admin:create -- …`, see `docs/SETUP.md`), configure **Admin → Settings**, and remove the sample products if you seeded them.

## Razorpay go-live checklist

Live payments stay disabled until **all** of these are done and the owner explicitly approves:

1. Complete Razorpay KYC/activation; note your settlement account.
2. Run real test-mode orders end-to-end on the deployed site: successful payment, failed payment, closed payment window, coupon order, cancellation + refund, and a duplicate webhook (use *Resend* in the Razorpay dashboard) — and confirm in **Admin → Orders** that each behaved correctly.
3. In Razorpay **Live Mode**: generate live API keys and create the live webhook (same URL and events as test mode, a new secret).
4. Set `RAZORPAY_KEY_ID=rzp_live_…`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (live) and **`RAZORPAY_ALLOW_LIVE=true`**. Without that last flag the server refuses live keys and online payment stays off.
5. Restart. **Admin → Settings → Integrations** shows *live mode* in red, and the API logs a warning at startup.
6. Place one small real order with a real payment method, verify it, then refund it from the admin panel and confirm the refund in Razorpay.
7. Keep payment auto-capture enabled in Razorpay (the server also captures authorised payments if it is off).

To roll back to test mode, restore the test keys and remove `RAZORPAY_ALLOW_LIVE`.

## Backups and recovery

**Database (MongoDB Atlas)**
* M10+ clusters: enable **Cloud Backup** with continuous backup / point-in-time restore. Keep at least 7 daily + 4 weekly snapshots.
* Free/shared tiers have limited or no automated backups — run a nightly `mongodump` from a trusted machine and store the archive encrypted off-site:
  ```bash
  mongodump --uri="$MONGODB_URI" --archive="ap-$(date +%F).gz" --gzip
  # restore into a NEW database first, verify, then switch:
  mongorestore --uri="$RESTORE_URI" --archive=ap-YYYY-MM-DD.gz --gzip --nsFrom='ap-creative-hub.*' --nsTo='ap-restore.*'
  ```
* Practise a restore at least once a quarter. `mongorestore` restores indexes, and the app re-ensures its unique indexes at startup. After a restore, reconcile recent orders against Razorpay settlements — payments captured after the backup was taken will need attention.
* Orders, payments and inventory adjustments are append-style records; never edit them by hand. If you must correct stock, use **Admin → Inventory** so the change is audited.

**Images (Cloudinary):** Cloudinary keeps originals; for an independent copy, periodically export the `ap-creative-hub` folder (Cloudinary backup add-on or Admin API). Product documents store each image's URL and public id, so images can be re-linked.

**Secrets:** keep `APP_SECRET`, Razorpay and Cloudinary keys in the host's secret store or a password manager. Rotating `APP_SECRET` signs everyone out and invalidates existing guest tracking links (customers can still sign in to view orders).

## Monitoring and routine operations

* Uptime check on `/api/v1/health` (returns `503` if the database is unreachable).
* Logs are JSON (pino) with request ids; passwords, cookies, CSRF tokens, payment signatures and tracking tokens are redacted. Ship them to your host's log viewer.
* Check **Admin → Dashboard → Needs attention** daily: it lists late/duplicate payments, amount mismatches, failed refunds and refunds issued outside the panel.
* **Admin → Notifications** shows any email failures.
* Rate limiting uses in-memory counters per instance. If you scale to several instances, move to a shared store (e.g. Redis via `rate-limit-redis`) in `server/src/middleware/security.ts`.
* Keep dependencies patched: `npm outdated`, `npm audit`, then `npm test` and redeploy.
