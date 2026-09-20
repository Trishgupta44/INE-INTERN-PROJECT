# Design note — making the scrape reliable

## What the store throws at you

I started by reading the store, not by writing a scraper. It is a Vite/React SPA with an empty HTML shell, so
plain HTML parsing gets nothing. Behind it:

- `/api/catalog` (1,000 items, page size capped at 60) has **no search** and **reshuffles order on every
  request**, so a "search" must first collect the whole catalog by id.
- The price on `/product/:id` is hidden until you **hover the price block with ≥ 8 real mouse moves
  (throttled to one per 40 ms), dwell ≥ 600 ms, and click "Reveal price" with a trusted click**. The click
  then runs a **challenge**: `GET /api/challenge` returns a salt, a difficulty and a base64 WASM module; the
  page does a proof-of-work, executes the WASM, collects a canvas / WebGL / requestAnimationFrame
  fingerprint plus the recorded mouse path and `event.isTrusted`, and posts it to `POST /api/session`.
  Synthetic events (`dispatchEvent`, `element.click()`) get `401 challenge_failed`. The quote itself comes
  back **encrypted** from `/api/products/:id/price`, so sniffing the JSON is not an option either.
- `/api/layout` rotates the **class names** of every price/stock element (`pv-k2`, `st-k2`, …), the facet
  order, the price element tag and whether the price is **split into one `<span>` per character joined by
  zero-width spaces**. A hidden `.price-value` decoy carries a *wrong* price.
- The price string comes in **seven formats** (`₹12,345`, spaced, `12.345,00`, `/- (incl. of all taxes)`,
  fullwidth Unicode digits, nbsp/zero-width joined, `Rs. 12,345.00`), next to a struck-through MRP, an
  optional "Deal price" and a "% off" badge. Stock has five phrasings or "Out of stock".
- Failure injection: the reveal click is **silently dropped ~17 % of the time and delayed 900 ms another
  17 %**; the price endpoint intermittently answers **500/503** (the page retries up to 6×), responses can
  be slow, a cookie-consent overlay pops up after a random delay and locks the page, and a `pending` flag
  marks some quotes as provisional.

## Decisions

**Headless browser only where it is genuinely required.** Catalog, search and product details are plain
HTTP with retries. The price needs trusted input events, WASM and a browser fingerprint, so that part runs in
Playwright/Chromium. One browser instance is shared; every attempt gets a fresh context so a poisoned
session never leaks into the next try.

**Read the layout contract instead of guessing selectors.** Each attempt fetches `/api/layout` from inside
the page and extracts by *those* class names. That is what the store itself does, so it keeps working when
the contract rotates. If the rendered block does not carry the contract's classes, the attempt fails with
`structure_change`, which also raises an alert on the dashboard — the scraper never "finds" the decoy.

**Move the mouse like a person.** A curved 16-point path across the block with 45–70 ms spacing, then small
random moves until the store enables the button, then a real `mouse.down/up` on the button. This satisfies
`minMoves`, `minDwellMs` and `isTrusted` without touching the page's JavaScript.

**Detect the dropped click.** After clicking, if the block is still in `price-idle` with the button armed
after 2.5 s, the click is re-sent (up to 6×). This one rule turned two of my first six probes from timeouts
into successes.

**Parse defensively, validate before writing.** `parse.js` is pure and unit-tested against all seven formats
plus the split carrier. It NFKC-normalises (fullwidth → ASCII, nbsp → space), strips zero-width characters,
recognises euro/lakh/trailing shapes, and returns `null` for anything else. `validateQuote` rejects
non-positive or fractional prices, MRP < price, missing stock. Only a validated quote reaches
`price_history`. A quote the store marks "Updating…" is provisional and *wrong* (it differs from the
settled figure); the scraper presses the store's "Refresh price" control until it settles and otherwise
fails the attempt with `provisional_price` — it is never stored.

**Honest logging.** One `scrape_logs` row per attempt: `retried` when it failed and another attempt
followed, `success` on the winning attempt (with the count of failed attempts before it, the store's own
retry messages, the raw price/stock strings and the layout revision), `failed` on the final attempt. Nothing
is swallowed; the UI shows the log verbatim.

**Bounded everything.** 45 s per attempt, 3 attempts with 1.5 s/3 s backoff, 8 s to let a pending price
settle, 8 s for the reveal button to arm. A run holds an in-memory lock and a `scrape_runs` row; a second
trigger gets `409` instead of a parallel run.

**Free-tier scheduling.** No in-process loop. cron-job.org posts to `/api/scrape/run` every 2 h and pings
`/api/health` every 10 min so Render does not sleep mid-run. The run endpoint returns `202` immediately and
processes products sequentially (one Chromium page at a time keeps the free instance within memory).

## Trade-offs

- **Sequential scraping** is slow (~4–6 s per product, more with retries) but predictable on 512 MB. With many
  products the 2 h window still holds; a worker pool would be the next step.
- **Catalog cached for 1 h** in memory. Search is instant and reshuffle-proof; a product added to the store
  shows up within an hour. The cache is per instance and rebuilds after a restart (17 requests).
- **Layout classes are re-read every attempt** rather than cached across `validUntil` — one extra request
  per attempt in exchange for never using a stale contract.
- **No email alerts.** Alerts are in-app (price drop/rise, stock transitions, structure change); SendGrid was
  left out to keep the secrets list short.
- **Attestation is whatever Chromium produces.** I do not spoof `navigator.webdriver` or fingerprints beyond
  Playwright's defaults (plus SwiftShader so WebGL exists on the server); the store accepts it today and
  spoofing would be the wrong thing to build.

## What the AI tooling got wrong first, and how I corrected it

1. **It assumed the price could be fetched over HTTP.** The first plan was cheerio + fetch. Loading the
   page showed an empty `<div id="root">`, and reading the bundle showed the challenge/session flow and an
   encrypted quote. Correction: HTTP for catalog/details, Playwright only for the price.
2. **It tried to satisfy the hover gate with synthetic events.** Dispatching `mouseover`/`mousemove` and
   calling `button.click()` armed the button but the session request came back `401 challenge_failed`
   because the attestation carried `trusted: false`. Correction: real pointer movement and a real click via
   Playwright's input pipeline, which produce trusted events.
3. **The first scraper waited only for success or error.** Two of the first six probes timed out with the
   status still "Price hidden" — the store had silently swallowed the click. Correction: detect the idle
   state after the click and re-click.
4. **It would have read the first big price-looking number in the block.** That is the hidden `.price-value`
   decoy (₹3,125 on a ₹2,766 product). Correction: extract only via the class from `/api/layout` and keep the
   decoy text in the log for auditing.
5. **The initial parser assumed `₹1,234` only.** Reading the bundle revealed seven formatters and the split
   carrier; the parser and its tests were rewritten around NFKC normalisation and zero-width stripping.
6. **Tooling suggested `node --test test/`,** which fails on Node 22 (directory argument); `node --test`
   auto-discovers `*.test.js`.
7. **It let "track" and "scrape now" start scrapes in parallel.** Tracking two products at once produced
   two Chromium contexts hitting `/api/layout` within a second and the store answered `429`. Correction:
   every scrape (track, manual, cron) goes through one in-process queue; the layout fetch retries with
   backoff and, if still throttled, derives the class names from the wrap class already on the rendered
   block (`pw-q9` → `pv-q9`, `st-q9`, …) and verifies them against the DOM.
8. **It treated a "provisional" quote as good enough to store with a flag.** Comparing runs showed the
   provisional figure (₹11,230, rendered next to "Updating…") differs from the settled price (₹9,132).
   Correction: the scraper presses the store's own "Refresh price" control (trusted click) up to three
   times and, if the quote never settles, fails the attempt with `provisional_price` — nothing is written.
9. **It assumed a keep-warm ping is enough on a free tier.** After deployment the scheduled runs silently
   stopped: the instance had gone to sleep, Render answered cron-job.org with its large wake-up page
   ("output too large"), and the scrape POST never reached the app. Correction: every request that reaches
   `/api/health` triggers a catch-up run for overdue products, the frontend pings health on load, and a
   GitHub Actions schedule waits for the backend to wake before posting the run.
10. **Its catalog loader assumed pagination was stable.** Every request is a fresh shuffle, so walking 17
   pages covered ~65% and four concurrent workers tripped the rate limit. Correction: sequential pages with
   a 300 ms gap, then the missing ids are fetched one by one from `/api/product/:id`, which is deterministic.
