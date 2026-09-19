// Quick manual probe: node scripts/probe.js 778 [--headed]
import { newPage, scrapeProductOnce, closeBrowser } from '../src/scraper/browser.js';

const id = process.argv[2] || '778';
const headed = process.argv.includes('--headed');
const t0 = Date.now();
const { page, context } = await newPage({ headless: !headed, slowMo: headed ? 40 : 0 });
page.on('request', (r) => {
  if (r.url().includes('/api/')) console.log('  ->', r.method(), r.url().replace(/^https?:\/\/[^/]+/, ''));
});
page.on('response', (r) => {
  if (r.url().includes('/api/')) console.log('  <-', r.status(), r.url().replace(/^https?:\/\/[^/]+/, ''));
});
try {
  const q = await scrapeProductOnce(page, id, { log: (m) => console.log(`[${Date.now() - t0}ms] ${m}`) });
  console.log(JSON.stringify(q, null, 2));
} catch (e) {
  console.error('FAILED', e.code || '', e.message, e.details ? JSON.stringify(e.details).slice(0, 1500) : '');
  process.exitCode = 1;
} finally {
  await context.close();
  await closeBrowser();
}
