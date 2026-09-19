import { Router } from 'express';
import { config } from '../config.js';
import { supabase, unwrap } from '../db.js';
import { runAll, runStatus } from '../scraper/run.js';

export const scrape = Router();

function authorized(req) {
  if (!config.cronSecret) return true;
  const given = req.get('x-cron-secret') || req.query.secret || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return given === config.cronSecret;
}

// cron-job.org calls this every 2 hours. Responds immediately; the run continues in the background
// (the /health keep-warm ping stops Render's free tier from sleeping mid-run).
scrape.post('/scrape/run', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'bad or missing cron secret' });
  const all = req.query.all === '1' || req.body?.all === true;
  const r = await runAll({ trigger: req.query.trigger || 'cron', all, log: (m) => console.log(`[run] ${m}`) });
  if (!r.started) return res.status(409).json({ started: false, reason: r.reason, run: r.run });
  res.status(202).json({ started: true, runId: r.runId });
});

scrape.get('/scrape/run', (req, res) => {
  // Some cron services can only issue GET; accept it with the same secret.
  if (!authorized(req)) return res.status(401).json({ error: 'bad or missing cron secret' });
  runAll({ trigger: req.query.trigger || 'cron', all: req.query.all === '1', log: (m) => console.log(`[run] ${m}`) }).then((r) =>
    res.status(r.started ? 202 : 409).json(r.started ? { started: true, runId: r.runId } : { started: false, reason: r.reason })
  );
});

scrape.get('/scrape/status', async (req, res) => {
  const status = runStatus();
  let runs = [];
  if (supabase) {
    runs = unwrap(await supabase.from('scrape_runs').select('*').order('started_at', { ascending: false }).limit(20));
  }
  res.json({ ...status, schedule: { everyHours: config.defaultIntervalHours, trigger: 'external cron (cron-job.org) -> POST /api/scrape/run' }, runs });
});
