# INE Store · Price Tracker

A small full-stack app that lets you pick products from INE's mock storefront
(https://demo.inelabteamdev.com) and tracks their **price and stock every 2 hours** by scraping the store.
The UI is a visual clone of the store itself.

| Piece | Tech | Hosted on |
|---|---|---|
| `frontend/` | React 18 + Vite + Recharts | Vercel |
| `backend/` | Node 20 + Express + Playwright (Chromium) | Render (free web service) |
| database | Supabase (PostgreSQL) — `supabase/schema.sql` | Supabase |
| schedule | external cron → `POST /api/scrape/run` | cron-job.org |

**Live site:** https://frontend-five-silk-96.vercel.app
**API:** https://ine-price-tracker-api-dggq.onrender.com/api/health
**Design note:** [`DESIGN_NOTES.md`](DESIGN_NOTES.md) · **Recording script:** [`docs/RECORDING.md`](docs/RECORDING.md)

> The backend runs on Render's free tier: the first request after ~15 minutes of inactivity takes 30–60 s
> while the instance wakes up; a keep-warm cron ping keeps that rare.

## What it does

1. **Search & track** — search the store by partial/full name (also brand, SKU, category), click *Track*.
   The product is persisted in Supabase and scraped immediately.
2. **Scheduled scraping** — every tracked product is scraped on a fixed schedule (default every 2 h,
   configurable per product from 1–24 h). Each scrape opens the real product page in Chromium, satisfies the
   store's hover-and-reveal gate with human-like pointer movement, passes its proof-of-work challenge, waits for
   the asynchronously loaded price, reads price + stock through the store's rotating layout contract, validates
   the numbers and only then writes a `price_history` row. A price the store marks "Updating…" is refreshed
   through the store's own control and never stored while provisional. All scrapes run one at a time through a
   single queue.
3. **History** — price and stock over time as a chart or a table, plus lowest/highest seen and success rate.
4. **Scrape log** — every attempt with timestamp, outcome (`success` / `retried` / `failed`), duration and the
   exact error. Failures are never hidden.
5. **Extras** — dashboard across all tracked products, in-app alerts (price drop / rise, back in stock /
   out of stock, page-structure change), MRP / discount / rating / seller facets, specs and reviews from the store,
   GitHub Actions CI with a live scrape smoke test.

## Scraping schedule

The backend never runs an always-on loop (free-tier instances sleep). Two cron-job.org jobs drive it:

| Job | Method / URL | Interval | Purpose |
|---|---|---|---|
| Scrape | `POST https://<backend>/api/scrape/run` with header `x-cron-secret: <CRON_SECRET>` | every 2 hours | scrapes every tracked product that is due (`last_scraped_at` older than its interval) |
| Keep-warm | `GET https://<backend>/api/health` | every 10 minutes | keeps the Render instance awake so runs are not cut short |

`/api/scrape/run` answers `202` immediately and processes products sequentially in the background; overlapping
runs are refused with `409`. `GET /api/scrape/status` shows the current run and the last 20 runs.
Products can also be scraped on demand from the UI (*Scrape now*).

## Running locally

```bash
# 1. database: create a Supabase project and run supabase/schema.sql in the SQL editor
# 2. backend
cd backend
cp .env.example .env        # fill SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
npm install
npm run setup               # downloads Chromium for Playwright (once)
npm run dev                 # http://localhost:4000
# 3. frontend (new terminal)
cd frontend
npm install
npm run dev                 # http://localhost:5173  (proxies /api to :4000)
```

Trigger a scheduled run by hand:

```bash
curl -X POST -H "x-cron-secret: <CRON_SECRET>" http://localhost:4000/api/scrape/run
```

### Headed (observable) run

```bash
cd backend
npm run scrape:headed -- --product 778                   # watch a real scrape in a visible browser
npm run scrape:headed -- --product 778 --simulate slow   # price response delayed 20 s -> attempt times out -> retry succeeds
npm run scrape:headed -- --product 778 --simulate fail   # price endpoint answers 503 -> store's own retries, then our retry
npm run scrape:headed -- --all                           # every tracked product, headed
```

Fault injection happens on our side with Playwright route interception; the store is not modified.
`--headless` runs the same thing without a window, `--no-db` skips Supabase writes.

### Tests

```bash
cd backend && npm test      # pure parser tests: all 7 price formats, split carrier, stock phrasings, validation
```

## Environment variables

### backend (`backend/.env`)

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `SUPABASE_URL` | yes | — | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | — | service-role key (backend is the only writer; RLS stays on with no public policies) |
| `CRON_SECRET` | yes | — | shared secret cron-job.org sends as `x-cron-secret` header (or `?secret=`) |
| `FRONTEND_ORIGIN` | prod | `*` | comma-separated allowed CORS origins, e.g. the Vercel URL |
| `PORT` | no | `4000` | HTTP port (Render sets it) |
| `STORE_BASE_URL` | no | `https://demo.inelabteamdev.com` | the only site the scraper touches |
| `SCRAPE_INTERVAL_HOURS` | no | `2` | default interval for new products |
| `SCRAPE_MAX_ATTEMPTS` | no | `3` | attempts per product per run |
| `SCRAPE_ATTEMPT_TIMEOUT_MS` | no | `45000` | hard timeout per attempt |
| `CATALOG_TTL_MS` | no | `3600000` | how long the 1,000-item catalog is cached for search |
| `HEADLESS` | no | `true` | set `false` to make the API server's browser visible |

### frontend (Vercel project settings or `frontend/.env`)

| Variable | Meaning |
|---|---|
| `VITE_API_BASE_URL` | backend URL on Render, e.g. `https://ine-price-tracker-api.onrender.com` (empty in dev: Vite proxies `/api`) |

## Deploying

1. **Supabase** — new project → SQL editor → paste `supabase/schema.sql` → run. Copy the project URL and the
   `service_role` key (Project settings → API).
2. **Render** — New → Blueprint → this repo (uses `render.yaml`), or New → Web Service with
   **Language: Docker**, root directory `backend`, Dockerfile path `backend/Dockerfile`. The image is
   Microsoft's official Playwright image, so Chromium and its system libraries are already present — the
   plain Node runtime cannot install them on the free tier. Set the secret env vars.
3. **Vercel** — import the repo, root directory `frontend`, framework Vite. Set `VITE_API_BASE_URL` to the Render URL.
   Then set `FRONTEND_ORIGIN` on Render to the Vercel URL.
4. **cron-job.org** — create the two jobs from the schedule table above.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | liveness, DB status, current run |
| GET | `/api/store/search?q=` | search the store catalog (cached, reshuffle-proof) |
| GET | `/api/products` | tracked products with latest reading and last log |
| POST | `/api/products` `{storeId}` | track a product (scrapes immediately) |
| GET | `/api/products/:id` | product + history + logs + alerts |
| PATCH | `/api/products/:id` `{scrape_interval_hours, active}` | per-product schedule / pause |
| DELETE | `/api/products/:id` | stop tracking |
| POST | `/api/products/:id/scrape` | scrape now |
| POST/GET | `/api/scrape/run` | cron entry point (secret required) |
| GET | `/api/scrape/status` | run status and history |
| GET | `/api/alerts`, POST `/api/alerts/seen` | alerts |

## Repository layout

```
backend/
  src/server.js            Express app
  src/routes/              products.js (search/track/history), scrape.js (cron + status)
  src/store/               catalog.js (HTTP catalog cache + search), http.js (fetch with retries)
  src/scraper/parse.js     pure price/stock parsing + validation (unit tested)
  src/scraper/browser.js   Playwright: navigate, hover gate, reveal, wait, extract via layout contract
  src/scraper/run.js       attempts, backoff, honest logging, persistence, alerts, run lock
  scripts/headed.js        observable run + fault injection
  scripts/probe.js         one-off probe of a product id
frontend/src/              React app (store-identical styling in store.css)
supabase/schema.sql        tables
render.yaml, frontend/vercel.json, .github/workflows/ci.yml
```
