import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { dbReady } from './db.js';
import { products } from './routes/products.js';
import { scrape } from './routes/scrape.js';
import { getCatalog } from './store/catalog.js';
import { runStatus } from './scraper/run.js';
import { closeBrowser } from './scraper/browser.js';

const app = express();
app.use(cors({ origin: config.frontendOrigin === '*' ? true : config.frontendOrigin.split(',').map((s) => s.trim()) }));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, db: dbReady, time: new Date().toISOString(), run: runStatus(), uptime: Math.round(process.uptime()) });
});
app.get('/', (req, res) => res.json({ service: 'INE price tracker backend', docs: '/api/health' }));
app.use('/api', products);
app.use('/api', scrape);

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Internal error' });
});

app.listen(config.port, () => {
  console.log(`backend listening on :${config.port} (db ${dbReady ? 'configured' : 'NOT configured'})`);
  getCatalog().then((c) => console.log(`catalog warmed: ${c.items.length} products`)).catch((e) => console.error('catalog warm-up failed', e.message));
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await closeBrowser();
    process.exit(0);
  });
}
