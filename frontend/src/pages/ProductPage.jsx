import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';
import CategoryIcon from '../components/CategoryIcon.jsx';
import { inr, when, whenFull, ago, stockLabel } from '../format.js';

const REVIEW_KEYS = ['warranty', 'inTheBox', 'countryOfOrigin', 'returns', 'support', 'weightGrams', 'material', 'colour', 'modelYear'];
const SPEC_LABEL = {
  warranty: 'Warranty',
  inTheBox: 'In the box',
  countryOfOrigin: 'Country of origin',
  returns: 'Returns',
  support: 'Support',
  weightGrams: 'Weight',
  material: 'Material',
  colour: 'Colour',
  modelYear: 'Model year',
};

export default function ProductPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [scraping, setScraping] = useState(false);
  const [view, setView] = useState('chart');

  const load = async () => {
    try {
      setData(await api.product(id));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return <div className="notice notice-error">{error} — <Link to="/tracked">back to tracked products</Link></div>;
  if (!data) return <div className="grid-empty">Loading…</div>;

  const { product, history, logs, alerts, run } = data;
  const latest = history[history.length - 1] || null;
  const first = history[0] || null;
  const min = history.length ? Math.min(...history.map((h) => Number(h.price))) : null;
  const max = history.length ? Math.max(...history.map((h) => Number(h.price))) : null;
  const specs = product.specs || {};
  const reviews = specs.reviews || [];
  const okCount = logs.filter((l) => l.status === 'success').length;
  const chartData = history.map((h) => ({ t: new Date(h.scraped_at).getTime(), price: Number(h.price), mrp: h.mrp ? Number(h.mrp) : null, stock: h.stock, label: when(h.scraped_at) }));

  const scrapeNow = async () => {
    setScraping(true);
    try {
      await api.scrapeNow(product.id);
      setTimeout(load, 4000);
      setTimeout(load, 12000);
      setTimeout(load, 25000);
    } catch (e) {
      alert(e.message);
    } finally {
      setTimeout(() => setScraping(false), 6000);
    }
  };

  const setInterval_ = async (hours) => {
    await api.update(product.id, { scrape_interval_hours: Number(hours) });
    load();
  };

  return (
    <section className="detail">
      <Link className="back-link" to="/tracked">‹ Back to tracked products</Link>
      <div className="detail-card">
        <div className="detail-media">
          <CategoryIcon category={product.category} />
        </div>
        <div className="detail-info">
          <span className="tile-category">{product.category}</span>
          <h1>{product.name}</h1>
          <p className="detail-brand">{product.brand} · SKU {product.sku}</p>
          <p className="detail-desc">{product.description}</p>

          <div className={`price-block price-tracker ${latest ? 'price-success' : 'price-idle'}`} aria-live="polite">
            {latest ? (
              <>
                <div className="price-main">
                  {latest.mrp && Number(latest.mrp) > Number(latest.price) && <span style={{ textDecoration: 'line-through', opacity: 0.55 }}>{inr(latest.mrp)}</span>}
                  <span className="price-value" style={{ opacity: latest.pending ? 0.45 : 1 }}>{inr(latest.price)}</span>
                  {latest.badge_pct ? <span style={{ color: '#2f855a', fontWeight: 600 }}>{latest.badge_pct}% off</span> : null}
                  {latest.pending ? <small className="muted">provisional</small> : null}
                </div>
                <div className="price-facets">
                  <span className={`stock-badge ${latest.in_stock ? 'in-stock' : 'out-stock'}`}>{stockLabel(latest)}</span>
                  {latest.rating != null && <small>Rated {latest.rating} / 5{latest.rating_count ? ` · ${latest.rating_count.toLocaleString('en-IN')} ratings` : ''}</small>}
                  {latest.seller && <small>Sold by {latest.seller}</small>}
                </div>
                <div className="price-meta">
                  <span>Scraped {ago(latest.scraped_at)} · {whenFull(latest.scraped_at)}</span>
                  <span>store format “{latest.price_format}” · layout rev {latest.layout_revision ?? '—'}</span>
                </div>
              </>
            ) : (
              <div>
                <p className="price-status">No price yet</p>
                <p className="price-substatus">{logs.length ? `Last attempt ${logs[0].status}: ${logs[0].error || ''}` : 'The first scrape is queued and usually completes within a minute.'}</p>
              </div>
            )}
          </div>

          <div className="inline-form" style={{ marginTop: '1rem' }}>
            <button type="button" className="btn btn-primary" onClick={scrapeNow} disabled={scraping || run?.running}>
              {run?.running ? 'Scrape in progress…' : scraping ? 'Queued…' : 'Scrape now'}
            </button>
            <label className="muted" style={{ fontSize: '.78rem' }}>
              Every{' '}
              <select value={product.scrape_interval_hours} onChange={(e) => setInterval_(e.target.value)}>
                {[1, 2, 3, 4, 6, 8, 12, 24].map((h) => (
                  <option key={h} value={h}>{h} h</option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.update(product.id, { active: !product.active }).then(load)}>
              {product.active ? 'Pause' : 'Resume'}
            </button>
          </div>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat"><span className="stat-label">Current</span><span className="stat-value">{latest ? inr(latest.price) : '—'}</span><div className="stat-sub">{latest ? stockLabel(latest) : 'no data'}</div></div>
        <div className="stat"><span className="stat-label">Lowest seen</span><span className="stat-value">{inr(min)}</span><div className="stat-sub">{history.length} readings</div></div>
        <div className="stat"><span className="stat-label">Highest seen</span><span className="stat-value">{inr(max)}</span><div className="stat-sub">since {first ? when(first.scraped_at) : '—'}</div></div>
        <div className="stat"><span className="stat-label">Scrape success</span><span className="stat-value">{logs.length ? `${Math.round((okCount / logs.length) * 100)}%` : '—'}</span><div className="stat-sub">{okCount} of {logs.length} attempts</div></div>
      </div>

      <div className="section-head">
        <h2>Price &amp; stock history</h2>
        <div className="inline-form">
          <button type="button" className={`btn btn-sm ${view === 'chart' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setView('chart')}>Chart</button>
          <button type="button" className={`btn btn-sm ${view === 'table' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setView('table')}>Table</button>
        </div>
      </div>

      {history.length === 0 && <div className="grid-empty">No readings yet.</div>}
      {history.length > 0 && view === 'chart' && (
        <div className="chart-card">
          <div className="chart-legend"><span>Price</span><span className="dashed">MRP</span></div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ left: 12, right: 24, top: 8, bottom: 8 }}>
              <CartesianGrid stroke="#e4e4e4" vertical={false} />
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(t) => when(new Date(t).toISOString())} tick={{ fontSize: 11, fill: '#767676' }} stroke="#e4e4e4" />
              <YAxis tickFormatter={(v) => inr(v)} tick={{ fontSize: 11, fill: '#767676' }} stroke="#e4e4e4" width={90} domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={{ border: '1px solid #111', borderRadius: 0, fontSize: 12 }}
                labelFormatter={(t) => whenFull(new Date(t).toISOString())}
                formatter={(v, name, item) => (name === 'stock' ? [v, 'Stock'] : [inr(v), name === 'price' ? 'Price' : 'MRP'])}
              />
              <Line type="stepAfter" dataKey="price" stroke="#111" strokeWidth={2} dot={{ r: 3, fill: '#111' }} isAnimationActive={false} />
              <Line type="stepAfter" dataKey="mrp" stroke="#767676" strokeDasharray="4 4" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
          <div className="chart-legend" style={{ paddingTop: '.5rem' }}><span>Stock</span></div>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={chartData} margin={{ left: 12, right: 24, top: 8, bottom: 8 }}>
              <CartesianGrid stroke="#e4e4e4" vertical={false} />
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(t) => when(new Date(t).toISOString())} tick={{ fontSize: 11, fill: '#767676' }} stroke="#e4e4e4" />
              <YAxis tick={{ fontSize: 11, fill: '#767676' }} stroke="#e4e4e4" width={90} allowDecimals={false} />
              <Tooltip contentStyle={{ border: '1px solid #111', borderRadius: 0, fontSize: 12 }} labelFormatter={(t) => whenFull(new Date(t).toISOString())} formatter={(v) => [v, 'Units in stock']} />
              <Line type="stepAfter" dataKey="stock" stroke="#111" strokeWidth={2} dot={{ r: 3, fill: '#111' }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {history.length > 0 && view === 'table' && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Scraped at</th><th>Price</th><th>MRP</th><th>Stock</th><th>Seller</th><th>Rating</th><th>Store format</th></tr>
            </thead>
            <tbody>
              {[...history].reverse().map((h) => (
                <tr key={h.id}>
                  <td>{whenFull(h.scraped_at)}</td>
                  <td className="num">{inr(h.price)}{h.pending ? ' *' : ''}</td>
                  <td>{h.mrp ? inr(h.mrp) : '—'}</td>
                  <td>{stockLabel(h)}</td>
                  <td>{h.seller || '—'}</td>
                  <td>{h.rating ?? '—'}</td>
                  <td className="mono">{h.price_format} / rev {h.layout_revision ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-head">
        <h2>Scrape log</h2>
        <small>every attempt, including failures</small>
      </div>
      {logs.length === 0 && <div className="grid-empty">No attempts yet.</div>}
      {logs.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Started</th><th>Outcome</th><th>Attempt</th><th>Duration</th><th>Result / error</th></tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td>{whenFull(l.started_at)}</td>
                  <td><span className={`status-badge status-${l.status}`}>{l.status}</span></td>
                  <td>{l.attempt}</td>
                  <td>{l.duration_ms != null ? `${(l.duration_ms / 1000).toFixed(1)} s` : '—'}</td>
                  <td className="mono">
                    {l.status === 'success'
                      ? `₹${l.details?.price} · stock ${l.details?.stock}${l.details?.store_retries?.length ? ` · store retried ${l.details.store_retries.length}×` : ''}${l.details?.failed_attempts_before?.length ? ` · after ${l.details.failed_attempts_before.length} failed attempt(s)` : ''}`
                      : `${l.error_code || 'error'}: ${l.error || ''}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {alerts.length > 0 && (
        <>
          <div className="section-head"><h2>Alerts</h2></div>
          <ul className="alert-list">
            {alerts.map((a) => (
              <li className="alert" key={a.id}>
                <span className={`status-badge ${a.type === 'price_drop' || a.type === 'back_in_stock' ? 'status-success' : a.type === 'structure_change' ? 'status-failed' : 'status-retried'}`}>{a.type.replace('_', ' ')}</span>
                <span>{a.message}</span>
                <time>{when(a.created_at)}</time>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="detail-extra">
        <h2>Specifications</h2>
        <dl className="spec-list">
          {REVIEW_KEYS.filter((k) => specs[k] != null).map((k) => (
            <div className="spec-row" key={k}>
              <dt>{SPEC_LABEL[k]}</dt>
              <dd>{k === 'weightGrams' ? `${specs[k]} g` : String(specs[k])}</dd>
            </div>
          ))}
        </dl>
        {reviews.length > 0 && (
          <>
            <h2>Customer reviews</h2>
            <ul className="review-list">
              {reviews.map((r) => (
                <li className="review" key={r.id}>
                  <div className="review-head">
                    <span className="review-stars" aria-label={`${r.rating} out of 5`}>{'★'.repeat(r.rating)}<span className="review-stars-off">{'★'.repeat(5 - r.rating)}</span></span>
                    <strong className="review-title">{r.title}</strong>
                  </div>
                  <p className="review-meta">{r.author} · {r.date}{r.verifiedPurchase ? <span className="review-verified"> · Verified purchase</span> : null}</p>
                  <p className="review-body">{r.body}</p>
                  <p className="review-helpful">{r.helpfulVotes} people found this helpful</p>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="detail-fineprint">Readings marked * were flagged as provisional by the store at scrape time. Tracked at {whenFull(product.created_at)} from store product #{product.store_id}.</p>
      </div>
    </section>
  );
}
