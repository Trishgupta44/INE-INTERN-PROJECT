import { chromium } from 'playwright';
import { config } from '../config.js';
import { parsePrice, parseStock, validateQuote } from './parse.js';

export class ScrapeError extends Error {
  constructor(code, message, details) {
    super(message || code);
    this.code = code;
    this.details = details;
  }
}

let browserPromise = null;
let browserOpts = null;

export async function getBrowser({ headless = config.headless, slowMo = 0 } = {}) {
  const key = `${headless}:${slowMo}`;
  if (browserPromise && browserOpts !== key) {
    await closeBrowser();
  }
  if (!browserPromise) {
    browserOpts = key;
    browserPromise = chromium
      .launch({
        headless,
        slowMo,
        args: ['--disable-blink-features=AutomationControlled', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
      })
      .then((b) => {
        b.on('disconnected', () => {
          browserPromise = null;
        });
        return b;
      })
      .catch((e) => {
        browserPromise = null;
        throw e;
      });
  }
  return browserPromise;
}

export async function closeBrowser() {
  const p = browserPromise;
  browserPromise = null;
  if (p) await p.then((b) => b.close()).catch(() => {});
}

export async function newPage(opts) {
  const browser = await getBrowser(opts);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 860 },
    deviceScaleFactor: 1,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  return { page, context };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const noop = () => {};

async function dismissCookieBanner(page) {
  const btn = page.locator('.cookie-banner button', { hasText: 'Decline' }).first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click({ timeout: 3000 }).catch(noop);
    await page.locator('.cookie-overlay').waitFor({ state: 'detached', timeout: 3000 }).catch(noop);
    return true;
  }
  return false;
}

async function humanHover(page, block, log) {
  const box = await block.boundingBox();
  if (!box) throw new ScrapeError('no_price_block', 'Price block has no layout box');
  const cx = box.x + box.width * 0.35;
  const cy = box.y + box.height * 0.5;
  await page.mouse.move(cx - 220, cy + 140, { steps: 6 });
  await sleep(80);
  // A gentle arc across the block: ~16 moves spaced above the 40 ms throttle, then dwell.
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const x = cx - 60 + t * 140;
    const y = cy + Math.sin(t * Math.PI) * 14 - 7;
    await page.mouse.move(x, y, { steps: 2 });
    await sleep(45 + Math.random() * 25);
  }
  log('hovered price block with human-like movement, waiting for dwell');
  const button = block.locator('button');
  const start = Date.now();
  while (Date.now() - start < 8000) {
    if (await button.isEnabled().catch(() => false)) return button;
    await page.mouse.move(cx + (Math.random() * 60 - 30), cy + (Math.random() * 16 - 8), { steps: 2 });
    await sleep(120);
  }
  throw new ScrapeError('reveal_not_enabled', 'Reveal button never became enabled after hovering');
}

const LAYOUT_KEYS = { priceWrap: 'pw', priceValue: 'pv', mrp: 'mr', sale: 'sl', badge: 'bd', rating: 'rt', seller: 'sr', delivery: 'dl', stock: 'st' };

async function fetchLayoutInPage(page, block, log) {
  let lastStatus = null;
  for (let i = 0; i < 3; i++) {
    const result = await page
      .evaluate(async () => {
        const r = await fetch('/api/layout');
        return { status: r.status, body: r.ok ? await r.json() : null };
      })
      .catch((e) => ({ status: 0, error: e.message }));
    if (result.body) {
      const layout = result.body;
      if (!layout?.classes?.priceValue || !layout?.classes?.stock) {
        throw new ScrapeError('structure_change', 'Layout contract missing expected keys', { layout });
      }
      return layout;
    }
    lastStatus = result.status || result.error;
    log(`layout endpoint answered ${lastStatus}, retrying`);
    await sleep(1500 * (i + 1));
  }
  // Fallback: the rendered block already carries the wrap class (e.g. "pw-k2"); the store derives every
  // other class from the same suffix. Verified against the real contract on every successful run.
  const suffix = await block.evaluate((el) => {
    const m = [...el.classList].map((c) => c.match(/^pw(-\w+)$/)).find(Boolean);
    return m ? m[1] : null;
  });
  if (!suffix) throw new ScrapeError('layout_unavailable', `Layout endpoint unavailable (${lastStatus}) and no wrap class on the price block`);
  log(`layout endpoint throttled (${lastStatus}); deriving classes from rendered suffix "${suffix}"`);
  const classes = Object.fromEntries(Object.entries(LAYOUT_KEYS).map(([k, p]) => [k, `${p}${suffix}`]));
  return { classes, revision: null, variant: null, derived: true };
}

async function extractQuote(page, layout) {
  const c = layout.classes;
  const data = await page.evaluate(
    ({ c }) => {
      const block = document.querySelector('.price-block.price-success');
      if (!block) return { missing: 'price-success' };
      const text = (el) => (el ? el.textContent : null);
      const priceEl = block.querySelector(`.${c.priceValue}`);
      const pendingMarker = /Updating…/.test(block.innerText) || (priceEl && getComputedStyle(priceEl).opacity !== '1');
      const ratingEl = block.querySelector(`.${c.rating}`);
      let rating = null;
      if (ratingEl) {
        const bar = ratingEl.querySelector('span > span');
        const w = bar && bar.style.width ? parseFloat(bar.style.width) : NaN;
        if (Number.isFinite(w)) rating = Math.round((w / 100) * 5 * 100) / 100;
      }
      return {
        wrapClassOk: block.classList.contains(c.priceWrap),
        priceText: text(priceEl),
        decoyText: text(block.querySelector('.price-value')),
        mrpText: text(block.querySelector(`.${c.mrp}`)),
        saleText: text(block.querySelector(`.${c.sale}`)),
        badgeText: text(block.querySelector(`.${c.badge}`)),
        stockText: text(block.querySelector(`.${c.stock} .stock-badge`)),
        stockOut: !!block.querySelector(`.${c.stock} .out-stock`),
        ratingText: text(ratingEl),
        rating,
        sellerText: text(block.querySelector(`.${c.seller}`)),
        deliveryText: text(block.querySelector(`.${c.delivery}`)),
        pending: pendingMarker,
        blockText: block.innerText,
        html: block.outerHTML.slice(0, 4000),
      };
    },
    { c }
  );
  if (data.missing) throw new ScrapeError('no_success_block', 'Price block disappeared before extraction');
  if (data.priceText == null) {
    throw new ScrapeError('structure_change', `Price element .${c.priceValue} not found in rendered block`, {
      layoutRevision: layout.revision,
      html: data.html,
    });
  }
  if (data.stockText == null) {
    throw new ScrapeError('structure_change', `Stock element .${c.stock} .stock-badge not found`, {
      layoutRevision: layout.revision,
      html: data.html,
    });
  }
  const price = parsePrice(data.priceText);
  const mrp = data.mrpText ? parsePrice(data.mrpText) : null;
  const sale = data.saleText ? parsePrice(data.saleText.replace(/deal price/i, '')) : null;
  const stock = data.stockOut ? parseStock('Out of stock') : parseStock(data.stockText);
  const problems = validateQuote({ price, mrp, stock });
  if (problems.length) {
    throw new ScrapeError('validation', problems.join('; '), {
      priceText: data.priceText,
      stockText: data.stockText,
      html: data.html,
    });
  }
  const badgePct = data.badgeText ? Number((data.badgeText.match(/(\d+)\s*%/) || [])[1]) || null : null;
  const ratingCount = data.ratingText ? (data.ratingText.match(/([\d.]+)(k?)\s*ratings/i) || null) : null;
  const seller = data.sellerText ? data.sellerText.normalize('NFKC').replace(/[​-‍﻿]/g, '').replace(/^\s*Sold by\s*/i, '').trim() : null;
  const deliveryMatch = data.deliveryText ? data.deliveryText.match(/Get it by\s+(.+)$/i) : null;
  return {
    price: price.value,
    priceFormat: price.format,
    mrp: mrp?.value ?? null,
    sale: sale?.value ?? null,
    badgePct,
    stock: stock.quantity,
    inStock: stock.inStock,
    pending: Boolean(data.pending),
    rating: data.rating,
    ratingCount: ratingCount ? Math.round(parseFloat(ratingCount[1]) * (ratingCount[2] ? 1000 : 1)) : null,
    seller,
    deliveryText: deliveryMatch ? deliveryMatch[1].trim() : null,
    currency: 'INR',
    layoutRevision: layout.revision ?? null,
    layoutVariant: layout.variant ?? null,
    raw: { priceText: data.priceText, stockText: data.stockText, decoyText: data.decoyText },
  };
}

/**
 * One full attempt on a fresh page: navigate, satisfy the hover gate, reveal, wait, extract, validate.
 * Throws ScrapeError with a stable `code` on any failure. Never returns partial data.
 */
export async function scrapeProductOnce(page, storeId, { log = noop, timeoutMs = config.attemptTimeoutMs } = {}) {
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(1000, deadline - Date.now());
  const storeRetries = [];
  const url = `${config.storeBaseUrl}/product/${storeId}`;

  log(`opening ${url}`);
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.min(20000, remaining()) }).catch((e) => {
    throw new ScrapeError('navigation', `Navigation failed: ${e.message}`);
  });
  if (res && res.status() >= 400) throw new ScrapeError('http_error', `Store responded ${res.status()} for product page`);

  const block = page.locator('.price-block').first();
  await block.waitFor({ state: 'visible', timeout: Math.min(20000, remaining()) }).catch(() => {
    throw new ScrapeError('no_price_block', 'Price block did not render (async load never completed)');
  });
  await dismissCookieBanner(page);

  const layout = await fetchLayoutInPage(page, block, log);
  log(`layout revision ${layout.revision ?? 'derived'} variant ${layout.variant ?? '-'} (price class .${layout.classes.priceValue})`);
  const wrapOk = await block.evaluate((el, cls) => el.classList.contains(cls), layout.classes.priceWrap);
  if (!wrapOk) throw new ScrapeError('structure_change', 'Rendered price block does not carry the layout wrap class', { layout });

  const clickReveal = async () => {
    const button = await humanHover(page, block, log);
    await dismissCookieBanner(page);
    const bb = await button.boundingBox();
    if (!bb) throw new ScrapeError('reveal_not_enabled', 'Reveal button not clickable');
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 4 });
    await sleep(120);
    await page.mouse.down();
    await sleep(60);
    await page.mouse.up();
  };

  const isSuccess = await block.evaluate((el) => el.classList.contains('price-success'));
  let clicks = 0;
  let lastClickAt = 0;
  if (!isSuccess) {
    await clickReveal();
    clicks = 1;
    lastClickAt = Date.now();
    log('clicked "Reveal price" (trusted click), waiting for the store to answer');
  }

  // Wait for a terminal state. Track the store's own retry attempts along the way.
  let lastStatus = '';
  const droppedClicks = [];
  while (true) {
    if (Date.now() > deadline) {
      throw new ScrapeError('timeout', `Timed out after ${timeoutMs} ms waiting for the price (last status: "${lastStatus}")`, { storeRetries, droppedClicks });
    }
    await dismissCookieBanner(page);
    const state = await block
      .evaluate((el) => ({
        cls: el.className,
        status: el.querySelector('.price-status')?.textContent || '',
        sub: el.querySelector('.price-substatus')?.textContent || '',
        buttonEnabled: !!el.querySelector('button') && !el.querySelector('button').disabled,
      }))
      .catch(() => null);
    if (!state) {
      await sleep(300);
      continue;
    }
    if (state.status !== lastStatus) {
      lastStatus = state.status;
      if (/retrying/i.test(state.status)) {
        storeRetries.push({ at: new Date().toISOString(), status: state.status, reason: state.sub });
        log(`store is retrying: ${state.status} ${state.sub}`);
      }
    }
    if (state.cls.includes('price-success')) break;
    if (state.cls.includes('price-error')) {
      throw new ScrapeError('store_error', `${state.status} ${state.sub}`.trim(), { storeRetries, droppedClicks });
    }
    // The store randomly swallows the reveal click (or delays it ~1 s). If nothing has started
    // loading after 2.5 s and the button is still armed, click again.
    if (state.cls.includes('price-idle') && state.buttonEnabled && Date.now() - lastClickAt > 2500) {
      if (clicks >= 6) throw new ScrapeError('reveal_ignored', 'Store ignored the reveal click 6 times', { droppedClicks });
      droppedClicks.push(new Date().toISOString());
      log(`store ignored the reveal click (${clicks}), clicking again`);
      await clickReveal();
      clicks++;
      lastClickAt = Date.now();
    }
    await sleep(250);
  }
  if (droppedClicks.length) storeRetries.push({ at: new Date().toISOString(), status: `reveal click re-sent ${droppedClicks.length}×`, reason: 'store dropped the click' });

  // A quote flagged "Updating…" is provisional and differs from the settled price. Use the store's own
  // "Refresh price" control (trusted click) until it settles; never store a provisional value.
  let quote = await extractQuote(page, layout);
  let refreshes = 0;
  while (quote.pending) {
    if (refreshes >= 3 || Date.now() + 5000 > deadline) {
      throw new ScrapeError('provisional_price', `Store kept the price provisional ("Updating…") after ${refreshes} refreshes; not storing ₹${quote.price}`, {
        provisionalPrice: quote.price,
        storeRetries,
      });
    }
    refreshes++;
    log(`store marks this price provisional ("Updating…"), pressing "Refresh price" (${refreshes}/3)`);
    const refresh = block.locator('.price-meta button', { hasText: /refresh/i }).first();
    const rb = await refresh.boundingBox().catch(() => null);
    if (!rb) throw new ScrapeError('structure_change', '"Refresh price" control not found on a provisional quote');
    await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2, { steps: 5 });
    await sleep(100);
    await page.mouse.down();
    await sleep(50);
    await page.mouse.up();
    // Wait for the block to leave and re-enter the success state.
    const refreshedBy = Math.min(deadline, Date.now() + 20000);
    let sawLoading = false;
    while (Date.now() < refreshedBy) {
      const cls = await block.evaluate((el) => el.className).catch(() => '');
      if (/price-error/.test(cls)) throw new ScrapeError('store_error', 'Store errored while refreshing a provisional price', { storeRetries });
      if (!/price-success/.test(cls)) sawLoading = true;
      else if (sawLoading) break;
      await sleep(200);
    }
    await sleep(300);
    quote = await extractQuote(page, layout);
  }
  if (refreshes) storeRetries.push({ at: new Date().toISOString(), status: `refreshed provisional price ${refreshes}×`, reason: 'store showed "Updating…"' });
  quote.storeRetries = storeRetries;
  log(`extracted price ${quote.price} (${quote.priceFormat}), stock ${quote.stock}`);
  return quote;
}
