import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import CategoryIcon from '../components/CategoryIcon.jsx';

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const initial = params.get('q') || '';
  const [q, setQ] = useState(initial);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState({});
  const navigate = useNavigate();
  const timer = useRef(null);

  const run = async (query) => {
    const value = query.trim();
    if (!value) {
      setResult(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setResult(await api.search(value));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initial) run(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onChange = (e) => {
    const value = e.target.value;
    setQ(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setParams(value ? { q: value } : {});
      run(value);
    }, 300);
  };

  const onSubmit = (e) => {
    e.preventDefault();
    clearTimeout(timer.current);
    setParams(q ? { q } : {});
    run(q);
  };

  const track = async (p) => {
    setBusy((b) => ({ ...b, [p.id]: true }));
    try {
      const saved = await api.track(p.id);
      navigate(`/tracked/${saved.id}`);
    } catch (e) {
      setError(e.message);
      setBusy((b) => ({ ...b, [p.id]: false }));
    }
  };

  return (
    <section className="browse">
      <div className="browse-intro">
        <h1>Track a product</h1>
        <p>Search INE's store by partial or full product name, then track it. Prices and stock are scraped every 2 hours.</p>
        <form className="search-form" onSubmit={onSubmit} role="search">
          <input className="search-input" value={q} onChange={onChange} placeholder="e.g. kettle, Helix Smart Bulb, NOR-10785" aria-label="Search products" autoFocus />
          <button type="submit" className="btn btn-primary">Search</button>
        </form>
        <p className="search-hint">
          {result ? `${result.items.length}${result.items.length === 60 ? '+' : ''} of ${result.total} products match “${result.query}”.` : 'Matches on name, brand, SKU and category.'}
        </p>
      </div>

      {error && <div className="notice notice-error">Couldn't search the store: {error}</div>}
      {loading && <div className="grid-empty">Searching the shelves…</div>}
      {!loading && result && result.items.length === 0 && <div className="grid-empty">Nothing on the shelves matches “{result.query}”.</div>}
      {!loading && result && result.items.length > 0 && (
        <div className="grid">
          {result.items.map((p) => (
            <article className={`tile${p.tracked ? ' tile-tracked' : ''}`} key={p.id}>
              <div className="tile-thumb">
                <CategoryIcon category={p.category} />
              </div>
              <div className="tile-body">
                <span className="tile-category">{p.category}</span>
                <h3 className="tile-name">{p.name}</h3>
                <p className="tile-brand">{p.brand}</p>
                <p className="tile-sku">SKU {p.sku}</p>
              </div>
              {p.tracked ? (
                <button type="button" className="tile-cta" onClick={() => navigate('/tracked')}>Already tracked →</button>
              ) : (
                <button type="button" className="tile-cta" disabled={!!busy[p.id]} onClick={() => track(p)}>
                  {busy[p.id] ? 'Tracking…' : 'Track this product →'}
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
