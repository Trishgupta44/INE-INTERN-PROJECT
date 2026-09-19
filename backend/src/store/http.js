const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchJson(url, { retries = 4, timeoutMs = 15000, baseDelayMs = 500 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} for ${url}`);
        err.status = res.status;
        if (res.status >= 400 && res.status < 500 && res.status !== 429) throw Object.assign(err, { fatal: true });
        throw err;
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (err.fatal || attempt === retries) break;
      // The store rate-limits bursts; back off much harder on 429 than on a flaky 5xx.
      const delay = err.status === 429 ? 3000 * attempt : baseDelayMs * 2 ** (attempt - 1);
      await sleep(delay);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}
