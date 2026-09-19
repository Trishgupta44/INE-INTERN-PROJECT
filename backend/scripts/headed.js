// Observable scraper run.
//   npm run scrape:headed -- --product 778                 visible browser, real store
//   npm run scrape:headed -- --product 778 --simulate slow  first attempt: price request delayed 20 s -> our timeout -> retry
//   npm run scrape:headed -- --product 778 --simulate fail  first attempt: price request answers 503 -> store retries -> then hard error -> our retry
//   npm run scrape:headed -- --all                          every tracked product from Supabase
//   add --headless to run the same thing without a window, --no-db to skip Supabase writes
import 'dotenv/config';
import { scrapeProduct, runAll } from '../src/scraper/run.js';
import { closeBrowser } from '../src/scraper/browser.js';
import { getProductDetails } from '../src/store/catalog.js';
import { supabase, unwrap } from '../src/db.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? def : args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
};
const headless = args.includes('--headless');
const simulate = opt('simulate', 'none');
const storeId = Number(opt('product', 0));
const timeoutMs = Number(process.env.SCRAPE_ATTEMPT_TIMEOUT_MS || 45000);

const log = (m) => console.log(`${new Date().toLocaleTimeString('en-IN', { hour12: false })}  ${m}`);
const browser = { headless, slowMo: headless ? 0 : 60 };

// Fault injection lives entirely on our side (Playwright route interception); the store is untouched.
function makeSimulator(mode) {
  if (mode === 'none' || mode === true) return null;
  return async (page, attempt) => {
    if (attempt !== 1) {
      log(`simulation: attempt ${attempt} runs clean`);
      return;
    }
    if (mode === 'slow') {
      log('simulation: delaying the price response by 20 s on attempt 1 (our per-attempt timeout is ' + Math.round(attemptTimeoutMs / 1000) + ' s)');
      await page.route('**/api/products/*/price*', async (route) => {
        await new Promise((r) => setTimeout(r, 20000));
        await route.continue();
      });
    } else if (mode === 'fail') {
      log('simulation: answering every price request with HTTP 503 on attempt 1 (store will show its own retries, then error)');
      await page.route('**/api/products/*/price*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"simulated_outage"}' }));
    } else if (mode === 'offline') {
      log('simulation: dropping the product page request on attempt 1');
      await page.route('**/product/*', (route) => route.abort('connectionfailed'));
    }
  };
}

// Keep the slow demo short: a 15 s attempt timeout is enough to show the timeout + retry path.
const attemptTimeoutMs = simulate === 'slow' ? Math.min(timeoutMs, 15000) : timeoutMs;

try {
  if (args.includes('--all')) {
    const r = await runAll({ trigger: 'headed', all: true, log, browser });
    if (!r.started) throw new Error('a run is already in progress');
    await r.finished;
  } else {
    if (!storeId) throw new Error('pass --product <storeId> (e.g. 778) or --all');
    let product = null;
    if (supabase && !args.includes('--no-db')) {
      const rows = unwrap(await supabase.from('products').select('*').eq('store_id', storeId).limit(1));
      product = rows[0] || null;
    }
    if (!product) {
      const d = await getProductDetails(storeId);
      product = { id: null, store_id: d.id, name: d.name };
      log(`product ${storeId} is not tracked in Supabase; running without persisting (${d.name})`);
    }
    const result = await scrapeProduct(product, { log, browser, simulate: makeSimulator(simulate), attemptTimeoutMs });
    log(result.ok ? `DONE: ₹${result.quote.price}, stock ${result.quote.stock} (attempt ${result.attempt})` : `FAILED after ${result.attempts.length} attempts`);
    process.exitCode = result.ok ? 0 : 1;
  }
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await closeBrowser();
}
