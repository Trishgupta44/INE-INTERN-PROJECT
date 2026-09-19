import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { fetchJson } from './http.js';

const PAGE_SIZE = 60; // the store silently caps pageSize at 60
const CACHE_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.cache', 'catalog.json');
let cache = { items: [], fetchedAt: 0, total: 0 };
let inflight = null;

// Restarts (dev watch, Render deploys) must not re-walk the store: keep the last catalog on disk.
const diskLoaded = readFile(CACHE_FILE, 'utf8')
  .then((txt) => {
    const saved = JSON.parse(txt);
    if (Array.isArray(saved.items) && saved.items.length) cache = saved;
  })
  .catch(() => {});

async function saveToDisk(data) {
  try {
    await mkdir(dirname(CACHE_FILE), { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(data));
  } catch {
    /* cache is best-effort */
  }
}

async function fetchPage(page) {
  return fetchJson(`${config.storeBaseUrl}/api/catalog?page=${page}&pageSize=${PAGE_SIZE}`);
}

async function loadCatalog() {
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const first = await fetchPage(1);
  const pages = first.pages || 1;
  const byId = new Map(first.items.map((p) => [p.id, p]));
  // Sequential with a small gap: the store rate-limits bursts (429) and 17 pages take ~6 s this way.
  for (let p = 2; p <= pages; p++) {
    await pause(300);
    const data = await fetchPage(p);
    for (const item of data.items) byId.set(item.id, item);
  }
  // Every request is a fresh random shuffle, so one walk covers ~65% and repeats converge slowly.
  // Do one more walk, then fetch whatever ids are still missing straight from /api/product/:id.
  for (let p = 1; p <= pages && byId.size < first.total; p++) {
    await pause(300);
    const data = await fetchPage(p);
    for (const item of data.items) byId.set(item.id, item);
  }
  const maxId = Math.max(first.total, ...byId.keys());
  for (let id = 1; id <= maxId && byId.size < first.total; id++) {
    if (byId.has(id)) continue;
    await pause(200);
    const d = await getProductDetails(id).catch(() => null);
    if (d?.id) byId.set(d.id, { id: d.id, slug: d.slug, name: d.name, brand: d.brand, category: d.category, sku: d.sku, description: d.description });
  }
  const items = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  cache = { items, fetchedAt: Date.now(), total: first.total };
  await saveToDisk(cache);
  return cache;
}

export async function getCatalog({ force = false } = {}) {
  await diskLoaded;
  const fresh = cache.items.length && Date.now() - cache.fetchedAt < config.catalogTtlMs;
  if (fresh && !force) return cache;
  if (!inflight) inflight = loadCatalog().finally(() => (inflight = null));
  if (cache.items.length && !force) {
    inflight.catch(() => {});
    return cache;
  }
  return inflight;
}

export async function searchCatalog(query, { limit = 60 } = {}) {
  const q = String(query || '').trim().toLowerCase();
  const { items, total, fetchedAt } = await getCatalog();
  if (!q) return { query: q, total, fetchedAt, items: [] };
  const words = q.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const p of items) {
    const name = p.name.toLowerCase();
    const hay = `${name} ${p.brand.toLowerCase()} ${p.sku.toLowerCase()} ${p.slug} ${p.category.toLowerCase()}`;
    if (!words.every((w) => hay.includes(w))) continue;
    let score = 0;
    if (name === q) score += 100;
    else if (name.startsWith(q)) score += 50;
    else if (name.includes(q)) score += 25;
    scored.push({ score, p });
  }
  scored.sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name));
  return { query: q, total, fetchedAt, items: scored.slice(0, limit).map((s) => s.p) };
}

export async function getProductDetails(storeId) {
  return fetchJson(`${config.storeBaseUrl}/api/product/${storeId}`);
}

export async function getLayout() {
  return fetchJson(`${config.storeBaseUrl}/api/layout`, { retries: 3, timeoutMs: 10000 });
}
