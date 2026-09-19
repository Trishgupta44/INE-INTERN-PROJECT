# Product Price Tracker — Design

Target: INE mock store at https://demo.inelabteamdev.com (assignment deadline 2026-09-20 23:59 IST).

## What the store does (observed)

- Vite/React SPA; server returns an empty shell. All data via `/api/*`.
- `GET /api/catalog?page=N&pageSize=M` — 1000 products, pageSize capped at 60 (17 pages). No search
  parameter; ordering is reshuffled on every request.
- `GET /api/product/:id` — static details (name, brand, category, sku, description, specs, reviews). No price.
- `GET /api/layout` — rotating DOM contract: randomised class names for `priceWrap`, `priceValue`, `mrp`,
  `sale`, `badge`, `rating`, `seller`, `delivery`, `stock`; `order` of facets; `priceTag` element;
  `priceCarrier` (`split` renders each character in its own `<span>` joined with zero-width spaces);
  `revision`, `variant`, `validUntil`.
- Price reveal on `/product/:id` requires: hover over `.price-block` with >= 8 `mousemove` events
  (40 ms throttle), dwell >= 600 ms, then a *trusted* click on "Reveal price". The client then runs a
  challenge (`GET /api/challenge` -> proof-of-work + WASM + canvas/WebGL/rAF fingerprint ->
  `POST /api/session`) and fetches an encrypted quote. Synthetic events fail with `challenge_failed`.
- The client wraps navigation/loads in a 35% chance of a 900 ms delay, half of which never fire at all.
  Quote fetch retries up to 6 times on HTTP errors and shows "Retrying (attempt n/6)".
- Rendered price uses one of 7 formats (default `₹12,345`, `spaced`, `euro` `12.345,00`, `trailing`
  `/- (incl. of all taxes)`, `unicode` fullwidth digits, `nbsp` zero-width + nbsp joins, `lakh`
  `Rs. 12,345.00`), may be `split` into per-character spans, and sits next to distractors: a hidden
  `.price-value` decoy, a struck-through MRP, an optional "Deal price", a "% off" badge. A `pending`
  flag renders the price at 45% opacity, meaning it is not final.
- Stock: `.stock-badge.in-stock` with 5 phrasings containing the number, or `.stock-badge.out-stock`
  "Out of stock".
- A cookie-consent overlay appears after a random delay and locks scrolling until Accept/Decline.

## Decision: headless browser for price, HTTP for everything else

Playwright (Chromium) is genuinely required for the price: trusted pointer events, WASM execution and a
browser fingerprint. Catalog, search and product details use plain HTTP.

## Architecture

```
frontend/  React + Vite (Vercel)  --->  backend/  Express + Playwright + Supabase client (Render)
                                             ^
cron-job.org  POST /api/scrape/run  (every 2 h, secret header)
cron-job.org  GET  /api/health      (every 10 min, keeps Render warm)
```

### Backend modules

- `src/store/catalog.js` — fetches all catalog pages, caches in memory (TTL 1 h), search by name/brand/sku.
- `src/store/details.js` — `GET /api/product/:id` passthrough.
- `src/scraper/parse.js` — pure functions: `parsePrice(text)`, `parseStock(text)`. Unit tested.
- `src/scraper/browser.js` — shared Chromium instance; `scrapeProductOnce(page, id, layout)`.
- `src/scraper/run.js` — orchestration: attempts, backoff, timeouts, logging, validation, persistence.
- `src/routes/*.js` — REST API.
- `src/db.js` — Supabase client (service role).
- `scripts/headed.js` — CLI for headed runs with optional fault injection.

### Data (Supabase)

- `products(id, store_id unique, slug, name, brand, category, sku, description, specs jsonb,
  scrape_interval_hours int default 2, active bool, created_at, last_scraped_at)`
- `price_history(id, product_id, price int, mrp int, sale int, currency, stock int, in_stock bool,
  pending bool, rating numeric, rating_count int, seller, delivery_days int, layout_revision int,
  scraped_at)`
- `scrape_logs(id, product_id, run_id uuid, started_at, finished_at, duration_ms, status
  ('success'|'retried'|'failed'), attempts int, error text, details jsonb)`
- `scrape_runs(id uuid, trigger text, started_at, finished_at, products int, ok int, failed int)`
- `alerts(id, product_id, type ('price_drop'|'back_in_stock'|'structure_change'), message, old_value,
  new_value, created_at, seen bool)`

### Reliability rules

1. Fresh `/api/layout` at the start of every product scrape; abort with `structure_change` if the expected
   classes are missing from the rendered DOM.
2. Human-like pointer path over the price block (12+ moves over ~800 ms), wait for the reveal button to
   enable, trusted click.
3. Wait for `.price-block.price-success`, then wait until no `pending` marker (bounded), then extract.
4. Handle cookie overlay whenever it appears.
5. Per-attempt timeout 45 s; up to 3 attempts per product with reload and exponential backoff.
6. Validate: integer price > 0, MRP >= price when present, stock integer >= 0. Otherwise treat as failure.
7. Only on validated success write `price_history`; every attempt writes `scrape_logs` with an honest
   status (`retried` when an earlier attempt failed but a later one succeeded).
8. One run at a time (in-memory lock + `scrape_runs` row); endpoint returns 202 immediately.

### Frontend

Visual clone of the store (same CSS, header, footer, tiles, detail card). Pages: Search & track,
Dashboard (all tracked products with latest price/stock, alerts), Product (chart, history table, scrape log,
specs, manual "Scrape now", per-product interval).

### Headed mode

`npm run scrape:headed -- --product 778 --simulate slow|fail|none` opens a visible browser, slows actions,
and (when simulating) intercepts the store's challenge/quote requests to delay or fail the first attempt so
the retry path is visible.
