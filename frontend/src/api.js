const BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

async function request(path, options = {}) {
  // Only send a content-type when there is a body: a bare GET then needs no CORS preflight.
  const res = await fetch(`${BASE}/api${path}`, {
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) },
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export const api = {
  health: () => request('/health'),
  search: (q) => request(`/store/search?q=${encodeURIComponent(q)}`),
  catalog: (page) => request(`/store/catalog?page=${page}&pageSize=20`),
  products: () => request('/products'),
  product: (id) => request(`/products/${id}`),
  track: (storeId) => request('/products', { method: 'POST', body: JSON.stringify({ storeId }) }),
  untrack: (id) => request(`/products/${id}`, { method: 'DELETE' }),
  update: (id, patch) => request(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  scrapeNow: (id) => request(`/products/${id}/scrape`, { method: 'POST' }),
  alerts: () => request('/alerts'),
  markAlertsSeen: () => request('/alerts/seen', { method: 'POST' }),
  scrapeStatus: () => request('/scrape/status'),
};
