// One consistent empty-state shape (icon + title + message + optional
// action) used everywhere instead of the bare "Hakuna kitu bado." text
// (docs/MASTER_TODO.md premium-UI pass §35). `icon` is a react-icons/fi
// component, passed by the caller rather than hardcoded here, so this
// stays a layout primitive, not an opinion about which icon fits which page.
export default function EmptyState({ icon: Icon, title, message, action }) {
  return (
    <div className="empty-state">
      {Icon && (
        <div className="empty-state__icon">
          <Icon aria-hidden="true" />
        </div>
      )}
      {title && <div className="empty-state__title">{title}</div>}
      {message && <div className="empty-state__message">{message}</div>}
      {action}
    </div>
  );
}
