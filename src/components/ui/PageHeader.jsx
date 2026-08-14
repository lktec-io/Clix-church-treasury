// Consistent page-title treatment: optional small eyebrow label, the
// heading itself, an optional subtitle, and a right-aligned action slot
// (e.g. a primary "New X" button) — used in place of a bare <h1> across
// treasurer-facing pages (docs/MASTER_TODO.md premium-UI pass §11).
export default function PageHeader({ eyebrow, title, subtitle, actions }) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <div className="page-header__eyebrow">{eyebrow}</div>}
        <h1 style={{ marginBottom: 0 }}>{title}</h1>
        {subtitle && <div className="page-header__subtitle">{subtitle}</div>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  );
}
