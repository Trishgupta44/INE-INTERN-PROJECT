// Same category glyphs the store draws in its tiles and detail page.
const ICONS = {
  Audio: (
    <>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <rect x="2.5" y="14" width="4" height="6" rx="1.2" />
      <rect x="17.5" y="14" width="4" height="6" rx="1.2" />
    </>
  ),
  Laptops: (
    <>
      <rect x="4" y="5" width="16" height="11" rx="1.5" />
      <path d="M2 20h20" />
    </>
  ),
  Wearables: (
    <>
      <circle cx="12" cy="12" r="5" />
      <path d="M9 7l.4-3h5.2L15 7M9 17l.4 3h5.2l.4-3" />
      <path d="M12 10v2l1.5 1" />
    </>
  ),
  Monitors: (
    <>
      <rect x="2.5" y="4" width="19" height="12" rx="1.5" />
      <path d="M9 20h6M12 16v4" />
    </>
  ),
  Peripherals: (
    <>
      <rect x="6" y="3" width="12" height="18" rx="6" />
      <path d="M12 7v4" />
    </>
  ),
  Power: <polygon points="13 2 4 14 11 14 10 22 20 10 13 10 13 2" />,
  'Smart Home': (
    <>
      <path d="M3 10l9-7 9 7v10a1.5 1.5 0 0 1-1.5 1.5H4.5A1.5 1.5 0 0 1 3 20z" />
      <path d="M9.5 21v-6h5v6" />
    </>
  ),
  Bags: (
    <>
      <path d="M6 8V6a3 3 0 0 1 6 0M9 8V6a3 3 0 0 1 6 0v2" />
      <path d="M4.5 8h15l-1 12.5A1.5 1.5 0 0 1 17 22H7a1.5 1.5 0 0 1-1.5-1.5z" />
    </>
  ),
  Kitchen: (
    <>
      <path d="M18 8h1.5a3 3 0 0 1 0 6H18" />
      <path d="M4 8h14v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" />
      <path d="M8 3v2M12 3v2" />
    </>
  ),
  Footwear: (
    <>
      <path d="M2 16c0-2 .8-3.4 2.4-4.4L7 14l2.5-5c1.6 1.7 4 2.6 7.5 2.8 2.2.1 4 1.7 4.5 3.7l.3 1.7" />
      <path d="M2 16v2.5A1.5 1.5 0 0 0 3.5 20h17a1.5 1.5 0 0 0 1.5-1.5V16" />
    </>
  ),
};

export default function CategoryIcon({ category }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={category} className="cat-icon">
      {ICONS[category] ?? <rect x="4" y="4" width="16" height="16" rx="1.5" />}
    </svg>
  );
}
