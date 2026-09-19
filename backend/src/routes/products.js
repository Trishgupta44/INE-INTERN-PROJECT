import { Router } from 'express';
import { requireDb, unwrap } from '../db.js';
import { searchCatalog, getProductDetails, getCatalog } from '../store/catalog.js';
import { queueScrape, runStatus } from '../scraper/run.js';

export const products = Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

products.get(
  '/store/search',
  wrap(async (req, res) => {
    const result = await searchCatalog(req.query.q, { limit: Number(req.query.limit) || 60 });
    let trackedIds = new Set();
    try {
      const db = requireDb();
      const rows = unwrap(await db.from('products').select('store_id'));
      trackedIds = new Set(rows.map((r) => r.store_id));
    } catch {
      /* search still works without a database */
    }
    res.json({ ...result, items: result.items.map((p) => ({ ...p, tracked: trackedIds.has(p.id) })) });
  })
);

products.get(
  '/store/catalog',
  wrap(async (req, res) => {
    const { items, total, fetchedAt } = await getCatalog();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(60, Math.max(1, Number(req.query.pageSize) || 20));
    res.json({ page, pageSize, pages: Math.ceil(items.length / pageSize), total, fetchedAt, items: items.slice((page - 1) * pageSize, page * pageSize) });
  })
);

products.get(
  '/products',
  wrap(async (req, res) => {
    const db = requireDb();
    const rows = unwrap(await db.from('products').select('*').order('created_at', { ascending: false }));
    const ids = rows.map((r) => r.id);
    let latest = {};
    let lastLogs = {};
    if (ids.length) {
      const hist = unwrap(
        await db.from('price_history').select('product_id, price, mrp, stock, in_stock, pending, scraped_at').in('product_id', ids).order('scraped_at', { ascending: false }).limit(ids.length * 12)
      );
      for (const h of hist) if (!latest[h.product_id]) latest[h.product_id] = h;
      const firstSeen = {};
      for (const h of hist) firstSeen[h.product_id] = h;
      const logs = unwrap(
        await db.from('scrape_logs').select('product_id, status, error_code, error, finished_at, attempt').in('product_id', ids).order('finished_at', { ascending: false }).limit(ids.length * 6)
      );
      for (const l of logs) if (!lastLogs[l.product_id]) lastLogs[l.product_id] = l;
      for (const p of rows) p.previous = firstSeen[p.id] && firstSeen[p.id] !== latest[p.id] ? firstSeen[p.id] : null;
    }
    res.json(rows.map((p) => ({ ...p, latest: latest[p.id] || null, last_log: lastLogs[p.id] || null })));
  })
);

products.post(
  '/products',
  wrap(async (req, res) => {
    const db = requireDb();
    const storeId = Number(req.body?.storeId);
    if (!Number.isInteger(storeId) || storeId <= 0) return res.status(400).json({ error: 'storeId (integer) is required' });
    const details = await getProductDetails(storeId).catch((e) => {
      const err = new Error(`Store did not return product ${storeId}: ${e.message}`);
      err.status = e.status === 404 ? 404 : 502;
      throw err;
    });
    const row = {
      store_id: details.id,
      slug: details.slug,
      name: details.name,
      brand: details.brand,
      category: details.category,
      sku: details.sku,
      description: details.description,
      specs: { ...(details.specs || {}), reviews: details.reviews || [] },
      active: true,
    };
    const saved = unwrap(await db.from('products').upsert(row, { onConflict: 'store_id' }).select().single());
    res.status(201).json(saved);
    if (req.body?.scrapeNow !== false) {
      queueScrape(saved, { trigger: 'track', log: (m) => console.log(`[scrape ${saved.store_id}] ${m}`) }).catch((e) => console.error('initial scrape failed', e));
    }
  })
);

products.get(
  '/products/:id',
  wrap(async (req, res) => {
    const db = requireDb();
    const id = Number(req.params.id);
    const product = unwrap(await db.from('products').select('*').eq('id', id).single());
    const [history, logs, alerts] = await Promise.all([
      db.from('price_history').select('*').eq('product_id', id).order('scraped_at', { ascending: true }).limit(2000),
      db.from('scrape_logs').select('*').eq('product_id', id).order('started_at', { ascending: false }).limit(300),
      db.from('alerts').select('*').eq('product_id', id).order('created_at', { ascending: false }).limit(50),
    ]);
    res.json({ product, history: unwrap(history), logs: unwrap(logs), alerts: unwrap(alerts), run: runStatus() });
  })
);

products.patch(
  '/products/:id',
  wrap(async (req, res) => {
    const db = requireDb();
    const id = Number(req.params.id);
    const patch = {};
    if (req.body?.scrape_interval_hours !== undefined) {
      const h = Number(req.body.scrape_interval_hours);
      if (!Number.isInteger(h) || h < 1 || h > 168) return res.status(400).json({ error: 'scrape_interval_hours must be 1..168' });
      patch.scrape_interval_hours = h;
    }
    if (req.body?.active !== undefined) patch.active = Boolean(req.body.active);
    const saved = unwrap(await db.from('products').update(patch).eq('id', id).select().single());
    res.json(saved);
  })
);

products.delete(
  '/products/:id',
  wrap(async (req, res) => {
    const db = requireDb();
    unwrap(await db.from('products').delete().eq('id', Number(req.params.id)));
    res.status(204).end();
  })
);

products.post(
  '/products/:id/scrape',
  wrap(async (req, res) => {
    const db = requireDb();
    const id = Number(req.params.id);
    const product = unwrap(await db.from('products').select('*').eq('id', id).single());
    queueScrape(product, { trigger: 'manual', log: (m) => console.log(`[manual ${product.store_id}] ${m}`) }).catch((e) => console.error('manual scrape failed', e));
    res.status(202).json({ queued: true, run: runStatus() });
  })
);

products.get(
  '/alerts',
  wrap(async (req, res) => {
    const db = requireDb();
    const rows = unwrap(await db.from('alerts').select('*, products(name, store_id)').order('created_at', { ascending: false }).limit(100));
    res.json(rows);
  })
);

products.post(
  '/alerts/seen',
  wrap(async (req, res) => {
    const db = requireDb();
    unwrap(await db.from('alerts').update({ seen: true }).eq('seen', false));
    res.json({ ok: true });
  })
);
