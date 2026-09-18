import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FiCheck, FiChevronDown, FiSearch } from 'react-icons/fi';

// A list this long is faster to filter than to scroll, so the open panel
// grows a search box at this threshold (members, accounts, categories).
const SEARCHABLE_FROM = 8;

/**
 * The application's single select control. Its text WRAPS — in the closed
 * control and in the open list — so a long department, account or member name
 * is never cut to "Huduma za Ja…" on a phone, which a native <select> cannot
 * guarantee.
 *
 * Accessibility follows the ARIA combobox pattern: the trigger is a combobox
 * owning a listbox; arrow keys move the active option (announced through
 * aria-activedescendant), Enter/Space choose, Escape closes, Home/End jump.
 * Short lists support first-letter type-ahead; long lists show a search field
 * that filters as you type.
 *
 * The open panel is rendered through a portal and positioned against the
 * trigger. That is what lets the control sit inside a horizontally scrolling
 * table (the category grid, the user role editor) without its list being
 * clipped by that scroll container.
 *
 * options: [{ value, label, meta? }] — values are compared as strings.
 * invalid + errorId wire the control to a page's inline validation message.
 */
export default function Dropdown({
  id,
  label,
  value,
  options,
  onChange,
  placeholder = '—',
  disabled = false,
  invalid = false,
  errorId,
  searchPlaceholder,
  ariaLabel,
}) {
  const autoId = useId();
  const baseId = id ?? autoId;
  const listId = `${baseId}-listbox`;
  const labelId = `${baseId}-label`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [query, setQuery] = useState('');
  const wrapRef = useRef(null);
  const listRef = useRef(null);
  const searchRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  // Viewport coordinates for the portalled panel.
  const [anchor, setAnchor] = useState(null);

  const searchable = options.length >= SEARCHABLE_FROM;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => String(o.label).toLowerCase().includes(q) || String(o.meta ?? '').toLowerCase().includes(q)
    );
  }, [options, query]);

  const selected = options.find((o) => String(o.value) === String(value)) ?? null;
  const selectedVisibleIndex = visible.findIndex((o) => String(o.value) === String(value));

  // Measure the trigger and decide whether the list opens downward or, when
  // the viewport is short of room, upward.
  const measure = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const flip = spaceBelow < 240 && spaceAbove > spaceBelow;
    setAnchor({
      left: rect.left,
      width: rect.width,
      top: flip ? undefined : rect.bottom + 4,
      bottom: flip ? window.innerHeight - rect.top + 4 : undefined,
      maxHeight: Math.max(160, (flip ? spaceAbove : spaceBelow) - 16),
    });
  }, []);

  // Close on a pointer press outside BOTH the control and its portalled panel.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (wrapRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Follow the trigger while anything scrolls or the window resizes — the
  // capture phase catches scrolling inside a table wrapper too.
  useLayoutEffect(() => {
    if (!open) return undefined;
    measure();
    const update = () => measure();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, measure]);

  // Move focus into the search field when a filterable list opens.
  useEffect(() => {
    if (open && searchable) searchRef.current?.focus();
  }, [open, searchable]);

  // Keep the active option in view inside the list's own scroll box only —
  // `block: 'nearest'` never scrolls the page.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const openList = () => {
    if (disabled || options.length === 0) return;
    setQuery('');
    setActiveIndex(selectedVisibleIndex >= 0 ? selectedVisibleIndex : 0);
    setOpen(true);
  };

  const close = ({ focusTrigger = false } = {}) => {
    setOpen(false);
    setQuery('');
    if (focusTrigger) triggerRef.current?.focus();
  };

  const choose = (index) => {
    const option = visible[index];
    if (option) onChange(option.value);
    close({ focusTrigger: true });
  };

  // Shared by the trigger and the search field, so the keyboard behaves the
  // same wherever focus happens to be.
  const onKeyDown = (e) => {
    if (disabled) return;
    const last = visible.length - 1;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) openList();
        else setActiveIndex((i) => Math.min(i + 1, last));
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) openList();
        else setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Home':
        if (open) {
          e.preventDefault();
          setActiveIndex(0);
        }
        break;
      case 'End':
        if (open) {
          e.preventDefault();
          setActiveIndex(last);
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (open) choose(activeIndex);
        else openList();
        break;
      case ' ':
        // In the search field a space is a character, not a command.
        if (!open || !searchable) {
          e.preventDefault();
          if (open) choose(activeIndex);
          else openList();
        }
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          close({ focusTrigger: true });
        }
        break;
      case 'Tab':
        if (open) close();
        break;
      default:
        // First-letter jump, for short lists that have no search field.
        if (!searchable && e.key.length === 1 && /\S/.test(e.key)) {
          const letter = e.key.toLowerCase();
          const start = open ? activeIndex : selectedVisibleIndex;
          for (let step = 1; step <= visible.length; step += 1) {
            const index = (start + step + visible.length) % visible.length;
            if (String(visible[index].label).toLowerCase().startsWith(letter)) {
              if (open) setActiveIndex(index);
              else onChange(visible[index].value);
              break;
            }
          }
        }
    }
  };

  return (
    <div className={`dropdown${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}${invalid ? ' is-invalid' : ''}`} ref={wrapRef}>
      {label && (
        <span className="dropdown__label" id={labelId}>
          {label}
        </span>
      )}
      <button
        type="button"
        id={baseId}
        ref={triggerRef}
        className="dropdown__trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={label ? `${labelId} ${baseId}` : undefined}
        aria-label={label ? undefined : ariaLabel}
        aria-activedescendant={open && activeIndex >= 0 ? `${baseId}-opt-${activeIndex}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid && errorId ? errorId : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
      >
        <span className={`dropdown__value${selected ? '' : ' is-placeholder'}`}>
          {selected ? selected.label : placeholder}
          {selected?.meta && <span className="dropdown__meta">{selected.meta}</span>}
        </span>
        <FiChevronDown className="dropdown__caret" aria-hidden="true" />
      </button>

      {open &&
        anchor &&
        createPortal(
          <div
            className="dropdown__panel"
            ref={panelRef}
            style={{
              position: 'fixed',
              left: anchor.left,
              width: anchor.width,
              top: anchor.top,
              bottom: anchor.bottom,
              maxHeight: anchor.maxHeight,
            }}
          >
            {searchable && (
              <div className="dropdown__search">
                <FiSearch aria-hidden="true" />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  autoComplete="off"
                  placeholder={searchPlaceholder ?? '…'}
                  aria-label={searchPlaceholder ?? label}
                  aria-controls={listId}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActiveIndex(0);
                  }}
                  onKeyDown={onKeyDown}
                />
              </div>
            )}
            <ul
              className="dropdown__list"
              id={listId}
              role="listbox"
              aria-labelledby={label ? labelId : undefined}
              aria-label={label ? undefined : ariaLabel}
              ref={listRef}
            >
              {visible.length === 0 && <li className="dropdown__empty">{placeholder === '—' ? '…' : placeholder}</li>}
              {visible.map((option, index) => {
                const isSelected = String(option.value) === String(value);
                return (
                  <li
                    key={option.value}
                    id={`${baseId}-opt-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    className={`dropdown__option${index === activeIndex ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}`}
                    // pointerdown + preventDefault keeps focus where it is, so
                    // the search field does not lose it mid-click.
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => choose(index)}
                    onPointerEnter={() => setActiveIndex(index)}
                  >
                    <span className="dropdown__option-text">
                      {option.label}
                      {option.meta && <span className="dropdown__meta">{option.meta}</span>}
                    </span>
                    {isSelected && <FiCheck className="dropdown__check" aria-hidden="true" />}
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body
        )}
    </div>
  );
}
