// Shimmering placeholder blocks — replaces plain "Inapakia..." text so a
// loading page visually resembles the content it's about to show
// (docs/MASTER_TODO.md premium-UI pass §34). Pure CSS animation
// (.skeleton in src/styles/cards.css), no Framer Motion needed for a
// continuous loop.
export function SkeletonText({ width = '100%' }) {
  return <div className="skeleton skeleton-text" style={{ width }} />;
}

export function SkeletonStatGrid({ count = 4 }) {
  return (
    <div className="stat-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div className="stat-tile" key={i}>
          <div className="skeleton" style={{ width: 34, height: 34, borderRadius: 'var(--radius-sm)', marginBottom: 10 }} />
          <SkeletonText width="60%" />
          <div className="skeleton" style={{ width: '80%', height: 22, marginTop: 6 }} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonCard({ lines = 3 }) {
  return (
    <div className="card">
      <div className="skeleton" style={{ width: '40%', height: 16, marginBottom: 16 }} />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonText key={i} width={i === lines - 1 ? '60%' : '100%'} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5, columns = 4 }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: columns }).map((_, c) => (
                <td key={c}>
                  <div className="skeleton" style={{ height: 14, width: c === 0 ? '70%' : '85%' }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
