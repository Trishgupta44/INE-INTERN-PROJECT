import { NavLink, Route, Routes, Link } from 'react-router-dom';
import SearchPage from './pages/SearchPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ProductPage from './pages/ProductPage.jsx';

export default function App() {
  return (
    <div className="app">
      <header className="site-header">
        <Link to="/" className="brand" aria-label="INE Store home">
          <span className="brand-mark" aria-hidden="true">◧</span> INE Store
        </Link>
        <nav className="site-nav" aria-label="Tracker">
          <NavLink to="/" end>Search &amp; track</NavLink>
          <NavLink to="/tracked">Tracked products</NavLink>
        </nav>
        <span className="tagline">Everyday goods, honestly priced.</span>
      </header>
      <main className="site-main">
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/tracked" element={<DashboardPage />} />
          <Route path="/tracked/:id" element={<ProductPage />} />
        </Routes>
      </main>
      <footer className="site-footer">Demo storefront. All products, brands, and prices are fictional. · Price tracker built for the INE Software Engineer Intern assignment.</footer>
    </div>
  );
}
