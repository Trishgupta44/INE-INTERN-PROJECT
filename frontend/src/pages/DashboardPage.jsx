import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import CategoryIcon from '../components/CategoryIcon.jsx';
import { inr, ago, when, stockLabel } from '../format.js';

export default function DashboardPage() {
  const [items, setItems] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const load = async () => {
    try {
      const [p, a, s] = await Promise.all([api.products(), api.alerts().catch(() => []), api.scrapeStatus().catch(() => null)]);
      setItems(p);
      setAlerts(a);
      setStatus(s);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const untrack = async (p) => {
    if (!confirm(`Stop tracking ${p.name}? History will be deleted.`)) return;
    await api.untrack(p.id);
    load();
  };

  const unseen = alerts.filter((a) => !a.seen);
  const lastRun = status?.runs?.[0];

  return (
    <section className="browse">
      <div className="browse-intro">
        <h1>Tracked products</h1>
        <p>
          {items ? `${items.length} product${items.length === 1 ? '' : 's'} tracked` : 'Loading…'} · scraped every {status?.schedule?.everyHours ?? 2} hours via cron-job.org
          {status?.running ? ` · a scrape run is in progress (${status.progress.done}/${status.progress.total})` : lastRun ? ` · last run ${ago(lastRun.started_at)}: ${lastRun.ok} ok, ${lastRun.failed} failed` : ''}
        </p>
      </div>

      {error && <div className="notice notice-error">Couldn't load tracked products: {error}</div>}

      {unseen.length > 0 && (
        <>
          <div className="section-head">
            <h2>Alerts</h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.markAlertsSeen().then(load)}>Mark all read</button>
          </div>
          <ul className="alert-list">
            {unseen.slice(0, 10).map((a) => (
              <li className="alert" key={a.id}>
                <span className={`status-badge ${a.type === 'price_drop' || a.type === 'back_in_stock' ? 'status-success' : a.type === 'structure_change' ? 'status-failed' : 'status-retried'}`}>{a.type.replace('_', ' ')}</span>
                <Link to={`/tracked/${a.product_id}`}>{a.message}</Link>
                <time>{when(a.created_at)}</time>
              </li>
            ))}
          </ul>
        </>
      )}

      {items && items.length === 0 && (
        <div className="grid-empty">
          Nothing tracked yet. <Link to="/" style={{ textDecoration: 'underline' }}>Search the store</Link> to pick a product.
        </div>
      )}

      {items && items.length > 0 && (
        <div className="grid">
          {items.map((p) => {
            const latest = p.latest;
            const log = p.last_log;
            return (
              <article className="tile" key={p.id}>
                <div className="tile-thumb">
                  <CategoryIcon category={p.category} />
                </div>
                <div className="tile-body">
                  <span className="tile-category">{p.category}</span>
                  <h3 className="tile-name">{p.name}</h3>
                  <p className="tile-brand">{p.brand}</p>
                  <p className="tile-sku">SKU {p.sku}</p>
                  <p className="tile-price">{latest ? inr(latest.price) : <span className="muted">no price yet</span>}</p>
                  {latest && (
                    <p className="tile-meta">
                      <span className={`stock-badge ${latest.in_stock ? 'in-stock' : 'out-stock'}`}>{stockLabel(latest)}</span>
                      {latest.pending ? ' · provisional' : ''}
                    </p>
                  )}
                  <p className="tile-meta">
                    Last scrape: {log ? <span className={`status-badge status-${log.status}`}>{log.status}</span> : '—'} {log ? ago(log.finished_at) : ''}
                    {log?.error ? <span className="mono" style={{ display: 'block', marginTop: '.3rem' }}>{log.error_code}: {log.error.slice(0, 90)}</span> : null}
                  </p>
                  <p className="tile-meta">Every {p.scrape_interval_hours} h · {p.active ? 'active' : 'paused'}</p>
                </div>
                <div className="tile-actions">
                  <button type="button" className="tile-cta" onClick={() => navigate(`/tracked/${p.id}`)}>View history →</button>
                  <button type="button" className="tile-cta" onClick={() => untrack(p)} aria-label={`Stop tracking ${p.name}`}>✕</button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
