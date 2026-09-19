import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

export const dbReady = Boolean(config.supabaseUrl && config.supabaseKey);

export const supabase = dbReady
  ? createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

export function requireDb() {
  if (!supabase) {
    const err = new Error('Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
    err.status = 503;
    throw err;
  }
  return supabase;
}

export function unwrap({ data, error }) {
  if (error) {
    const err = new Error(error.message);
    err.status = error.code === 'PGRST116' ? 404 : 500;
    err.cause = error;
    throw err;
  }
  return data;
}
