import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { supabase, unwrap } from '../db.js';
import { newPage, scrapeProductOnce, ScrapeError } from './browser.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const noop = () => {};

let current = null; // { runId, trigger, startedAt, progress }
let queued = 0;

// One browser page at a time, always: the store rate-limits and the free tier has ~512 MB.
let chain = Promise.resolve();
function withLock(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(noop);
  return p;
}

export function runStatus() {
  return current ? { running: true, queued, ...current } : { running: false, queued };
}

/** Scrape a single product as soon as the lock is free (used by "track" and "scrape now"). */
export function queueScrape(product, opts = {}) {
  queued++;
  return withLock(async () => {
    queued--;
    const wasIdle = !current;
    if (wasIdle) current = { runId: null, trigger: opts.trigger || 'manual', startedAt: new Date().toISOString(), progress: { done: 0, total: 1, ok: 0, failed: 0 } };
    try {
      const r = await scrapeProduct(product, opts);
      if (wasIdle) {
        current.progress.done = 1;
        r.ok ? current.progress.ok++ : current.progress.failed++;
      }
      return r;
    } finally {
      if (wasIdle) current = null;
    }
  });
}

async function insertLog(row) {
  if (!supabase || row.product_id == null) return;
  unwrap(await supabase.from('scrape_logs').insert(row));
}

async function latestHistory(productId) {
  if (!supabase) return null;
  const rows = unwrap(
    await supabase
      .from('price_history')
      .select('price, stock, in_stock, scraped_at')
      .eq('product_id', productId)
      .order('scraped_at', { ascending: false })
      .limit(1)
  );
  return rows?.[0] || null;
}

async function raiseAlerts(product, prev, quote) {
  if (!supabase || !prev) return [];
  const alerts = [];
  const fmt = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
  if (quote.price < Number(prev.price)) {
    alerts.push({ type: 'price_drop', message: `${product.name} dropped from ${fmt(prev.price)} to ${fmt(quote.price)}`, old_value: String(prev.price), new_value: String(quote.price) });
  } else if (quote.price > Number(prev.price)) {
    alerts.push({ type: 'price_rise', message: `${product.name} rose from ${fmt(prev.price)} to ${fmt(quote.price)}`, old_value: String(prev.price), new_value: String(quote.price) });
  }
  if (!prev.in_stock && quote.inStock) {
    alerts.push({ type: 'back_in_stock', message: `${product.name} is back in stock (${quote.stock} left)`, old_value: '0', new_value: String(quote.stock) });
  } else if (prev.in_stock && !quote.inStock) {
    alerts.push({ type: 'out_of_stock', message: `${product.name} went out of stock`, old_value: String(prev.stock), new_value: '0' });
  }
  if (alerts.length) {
    unwrap(await supabase.from('alerts').insert(alerts.map((a) => ({ ...a, product_id: product.id }))));
  }
  return alerts;
}

async function persistSuccess(product, quote, runId) {
  if (!supabase || product.id == null) return;
  const prev = await latestHistory(product.id);
  unwrap(
    await supabase.from('price_history').insert({
      product_id: product.id,
      run_id: runId,
      price: quote.price,
      mrp: quote.mrp,
      sale: quote.sale,
      badge_pct: quote.badgePct,
      currency: quote.currency,
      stock: quote.stock,
      in_stock: quote.inStock,
      pending: quote.pending,
      rating: quote.rating,
      rating_count: quote.ratingCount,
      seller: quote.seller,
      delivery_days: null,
      price_format: quote.priceFormat,
      layout_revision: quote.layoutRevision,
    })
  );
  unwrap(await supabase.from('products').update({ last_scraped_at: new Date().toISOString() }).eq('id', product.id));
  return raiseAlerts(product, prev, quote);
}

async function structureAlert(product, err) {
  if (!supabase || product.id == null) return;
  unwrap(
    await supabase.from('alerts').insert({
      product_id: product.id,
      type: 'structure_change',
      message: `Store page structure changed while scraping ${product.name}: ${err.message}`,
      old_value: null,
      new_value: err.details?.layoutRevision ? String(err.details.layoutRevision) : null,
    })
  );
}

/**
 * Scrape one tracked product with retries. Every attempt is logged honestly:
 *   - an attempt that failed but will be retried  -> 'retried'
 *   - the attempt that finally succeeded          -> 'success' (details.attempts_before tells how many failed first)
 *   - the last attempt when all failed            -> 'failed'
 * Price history is only written from a validated, successful attempt.
 */
export async function scrapeProduct(product, { runId = null, log = noop, browser = {}, maxAttempts = config.maxAttempts, simulate = null, attemptTimeoutMs = config.attemptTimeoutMs } = {}) {
  const attemptsInfo = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = new Date();
    const t0 = Date.now();
    let pageBundle;
    log(`attempt ${attempt}/${maxAttempts} for "${product.name}" (store id ${product.store_id})`);
    try {
      pageBundle = await newPage(browser);
      if (simulate) await simulate(pageBundle.page, attempt);
      const quote = await scrapeProductOnce(pageBundle.page, product.store_id, { log, timeoutMs: attemptTimeoutMs });
      const durationMs = Date.now() - t0;
      const alerts = await persistSuccess(product, quote, runId);
      await insertLog({
        product_id: product.id,
        run_id: runId,
        attempt,
        status: 'success',
        started_at: startedAt.toISOString(),
        finished_at: new Date().toISOString(),
        duration_ms: durationMs,
        error_code: null,
        error: null,
        details: {
          price: quote.price,
          stock: quote.stock,
          pending: quote.pending,
          price_format: quote.priceFormat,
          layout_revision: quote.layoutRevision,
          store_retries: quote.storeRetries,
          raw: quote.raw,
          failed_attempts_before: attemptsInfo,
          alerts: alerts?.map((a) => a.type) || [],
        },
      });
      log(`success in ${durationMs} ms: ₹${quote.price}, stock ${quote.stock}`);
      return { ok: true, attempt, quote, alerts };
    } catch (err) {
      const durationMs = Date.now() - t0;
      const code = err instanceof ScrapeError ? err.code : 'unexpected';
      const message = err.message || String(err);
      const info = { attempt, code, message, duration_ms: durationMs, at: startedAt.toISOString() };
      attemptsInfo.push(info);
      const willRetry = attempt < maxAttempts;
      log(`attempt ${attempt} failed [${code}]: ${message}${willRetry ? ' — will retry' : ''}`);
      await insertLog({
        product_id: product.id,
        run_id: runId,
        attempt,
        status: willRetry ? 'retried' : 'failed',
        started_at: startedAt.toISOString(),
        finished_at: new Date().toISOString(),
        duration_ms: durationMs,
        error_code: code,
        error: message,
        details: { ...(err.details || {}), store_retries: err.details?.storeRetries },
      }).catch((e) => log(`could not write log: ${e.message}`));
      if (code === 'structure_change') await structureAlert(product, err).catch(noop);
      if (!willRetry) return { ok: false, attempts: attemptsInfo };
      await sleep(1500 * 2 ** (attempt - 1));
    } finally {
      await pageBundle?.context.close().catch(noop);
    }
  }
  return { ok: false, attempts: attemptsInfo };
}

export async function dueProducts({ all = false } = {}) {
  if (!supabase) return [];
  const products = unwrap(await supabase.from('products').select('*').eq('active', true).order('id'));
  if (all) return products;
  const now = Date.now();
  return products.filter((p) => {
    if (!p.last_scraped_at) return true;
    const hours = p.scrape_interval_hours || config.defaultIntervalHours;
    // 5-minute grace so a cron firing slightly early still counts.
    return now - new Date(p.last_scraped_at).getTime() >= hours * 3600_000 - 5 * 60_000;
  });
}

/**
 * Scrape every due product sequentially. Returns immediately with `already running` when a run is active.
 */
export async function runAll({ trigger = 'manual', all = false, productIds = null, log = noop, browser = {} } = {}) {
  if (current) return { started: false, reason: 'already_running', run: current };
  const runId = randomUUID();
  current = { runId, trigger, startedAt: new Date().toISOString(), progress: { done: 0, total: 0, ok: 0, failed: 0 } };
  const finished = withLock(async () => {
    let products = [];
    try {
      products = await dueProducts({ all });
      if (productIds) products = products.filter((p) => productIds.includes(p.id));
      current.progress.total = products.length;
      if (supabase) unwrap(await supabase.from('scrape_runs').insert({ id: runId, trigger, products: products.length }));
      for (const product of products) {
        const r = await scrapeProduct(product, { runId, log, browser });
        current.progress.done++;
        if (r.ok) current.progress.ok++;
        else current.progress.failed++;
        await sleep(1000);
      }
      if (supabase) {
        unwrap(
          await supabase
            .from('scrape_runs')
            .update({ finished_at: new Date().toISOString(), ok: current.progress.ok, failed: current.progress.failed })
            .eq('id', runId)
        );
      }
    } catch (e) {
      log(`run ${runId} aborted: ${e.message}`);
      if (supabase) {
        await supabase.from('scrape_runs').update({ finished_at: new Date().toISOString(), note: `aborted: ${e.message}` }).eq('id', runId);
      }
    } finally {
      const summary = { ...current };
      current = null;
      log(`run ${runId} finished: ${summary.progress.ok} ok, ${summary.progress.failed} failed of ${summary.progress.total}`);
    }
  });
  return { started: true, runId, finished };
}
