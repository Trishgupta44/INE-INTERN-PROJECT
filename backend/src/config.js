import 'dotenv/config';

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const config = {
  port: num(process.env.PORT, 4000),
  storeBaseUrl: (process.env.STORE_BASE_URL || 'https://demo.inelabteamdev.com').replace(/\/$/, ''),
  // Accept the Data API URL as pasted from the dashboard (…supabase.co/rest/v1/) as well as the bare project URL.
  supabaseUrl: (process.env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, ''),
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  cronSecret: process.env.CRON_SECRET || '',
  frontendOrigin: process.env.FRONTEND_ORIGIN || '*',
  defaultIntervalHours: num(process.env.SCRAPE_INTERVAL_HOURS, 2),
  maxAttempts: num(process.env.SCRAPE_MAX_ATTEMPTS, 3),
  attemptTimeoutMs: num(process.env.SCRAPE_ATTEMPT_TIMEOUT_MS, 45000),
  catalogTtlMs: num(process.env.CATALOG_TTL_MS, 60 * 60 * 1000),
  headless: process.env.HEADLESS !== 'false',
};
