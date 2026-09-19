# Screen-recording script (2–4 minutes)

Record with Xbox Game Bar (Win + G → Record) or OBS. Keep one terminal and one browser window visible.
Use `--product 778` (Auralite Messenger Bag X) unless you prefer another tracked product.

## Before recording

```bash
cd backend
npm run scrape:headed -- --product 778 --no-db --simulate none
```

Run it once off-camera so Chromium is warm and you know where the window opens.

## Take 1 — a clean headed run (~45 s)

```bash
npm run scrape:headed -- --product 778
```

Narrate while it runs:
- "The scraper opens the real product page in a visible Chromium."
- "It reads the store's `/api/layout` contract — class names rotate, this run is `.pv-…`."
- "It moves the mouse across the price block like a person — the store requires eight real moves and a
  600 ms dwell before it arms the button — then sends a trusted click."
- "The store runs its proof-of-work challenge; the price loads; the scraper reads price and stock through
  the layout classes, ignoring the hidden decoy, validates, and prints the result."
- Point at the terminal line `extracted price … stock …` and `DONE`.

## Take 2 — a failing response (~60 s)

```bash
npm run scrape:headed -- --product 778 --simulate fail
```

- "For this run I intercept the store's price endpoint on attempt 1 and answer 503 — the store itself is
  untouched."
- Show the page cycling through "Retrying (attempt 2/6)…" and the terminal lines `store is retrying`.
- Show `attempt 1 failed [store_error] … — will retry`.
- "Attempt 2 runs clean and succeeds. Both attempts are written to the scrape log: attempt 1 as
  `retried`, attempt 2 as `success`."

## Take 3 — a slow response (~45 s)

```bash
npm run scrape:headed -- --product 778 --simulate slow
```

- "Now the price response is delayed 20 s; the per-attempt timeout for the demo is 15 s."
- Show the spinner sitting on "Loading current price…", then `attempt 1 failed [timeout]`.
- "Attempt 2 succeeds. Nothing was stored from the timed-out attempt."

## Take 4 — the dashboard (~30 s)

Open the live site → *Tracked products* → the product → scroll to **Scrape log**:
- Point at the `retried` / `success` / `failed` rows with timestamps, durations and error codes.
- Point at the chart and the readings table.

Stop recording. Trim to 2–4 minutes.
