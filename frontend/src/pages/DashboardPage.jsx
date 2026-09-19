import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import CategoryIcon from '../components/CategoryIcon.jsx';
import { inr, ago, when, stockLabel } from '../format.js';

const badgeClass = (type) =>
  type === 'price_drop' || type === 'back_in_stock' ? 'status-success' : type === 'structure_change' ? 'status-failed' : 'status-retried';

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
    if (!confirm(`Stop tracking ${p.name}? Its history will be deleted.`)) return;
    await api.untrack(p.id);
    load();
  };

  const unseen = alerts.filter((a) => !a.seen);
  const lastRun = status?.runs?.[0];
  const running = status?.running;

  return (
    <section className="browse">
      <div className="browse-intro">
        <span className="eyebrow">Watchlist</span>
        <h1>Tracked products</h1>
        <p>
          {items ? `${items.length} product${items.length === 1 ? '' : 's'}` : 'Loading…'} · scraped every {status?.schedule?.everyHours ?? 2} hours
          {running
            ? ` · scraping now (${status.progress.done}/${status.progress.total})`
            : lastRun
              ? ` · last run ${ago(lastRun.started_at)}: ${lastRun.ok} ok, ${lastRun.failed} failed`
              : ''}
        </p>
      </div>

      {error && <div className="notice notice-error">Couldn't load tracked products: {error}</div>}

      {unseen.length > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 0 }}>
            <h2>Alerts</h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.markAlertsSeen().then(load)}>Mark all read</button>
          </div>
          <ul className="alert-list" style={{ marginBottom: '2.5rem' }}>
            {unseen.slice(0, 10).map((a) => (
              <li className="alert" key={a.id}>
                <span className={`status-badge ${badgeClass(a.type)}`}>{a.type.replace('_', ' ')}</span>
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
                  <div className="tile-head">
                    <span className="tile-category">{p.category}</span>
                    <span className={`chip${p.active ? '' : ' chip-ink'}`}>{p.active ? `every ${p.scrape_interval_hours} h` : 'paused'}</span>
                  </div>
                  <h3 className="tile-name">{p.name}</h3>
                  <p className="tile-brand">{p.brand}</p>
                  <p className="tile-sku">SKU {p.sku}</p>
                  <div className="tile-price-row">
                    {latest ? <span className="tile-price">{inr(latest.price)}</span> : <span className="tile-price muted">awaiting first reading</span>}
                    {latest && <span className={`stock-badge ${latest.in_stock ? 'in-stock' : 'out-stock'}`}>{stockLabel(latest)}</span>}
                  </div>
                  <div className="tile-status">
                    {log ? (
                      <>
                        <span className={`dot dot-${log.status}`} aria-hidden="true" />
                        <span>
                          {log.status === 'success' ? 'Scraped' : log.status === 'retried' ? 'Retrying' : 'Failed'} {ago(log.finished_at)}
                          {log.error_code ? <span className="mono"> · {log.error_code}</span> : null}
                        </span>
                      </>
                    ) : (
                      <span>First scrape queued</span>
                    )}
                  </div>
                </div>
                <div className="tile-actions">
                  <button type="button" className="tile-cta" onClick={() => navigate(`/tracked/${p.id}`)}>View history →</button>
                  <button type="button" className="tile-cta tile-cta-quiet" onClick={() => untrack(p)} aria-label={`Stop tracking ${p.name}`}>Untrack</button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
