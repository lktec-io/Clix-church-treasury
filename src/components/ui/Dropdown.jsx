import { useEffect, useId, useRef, useState } from 'react';
import { FiCheck, FiChevronDown } from 'react-icons/fi';

/**
 * Flat single-select dropdown whose text WRAPS — in the closed control and in
 * the open list — so a long department or account name is never cut to
 * "Huduma za Ja…" on a phone, which a native <select> cannot guarantee.
 *
 * Accessibility follows the ARIA "select-only combobox" pattern: the trigger
 * is a combobox that owns a listbox; arrow keys move the active option
 * (announced via aria-activedescendant), Enter/Space choose, Escape closes,
 * Home/End jump, and typing a letter jumps to the next matching option.
 *
 * options: [{ value, label, meta? }] — values are compared as strings.
 */
export default function Dropdown({ id, label, value, options, onChange, placeholder = '—', disabled = false }) {
  const autoId = useId();
  const baseId = id ?? autoId;
  const listId = `${baseId}-listbox`;
  const labelId = `${baseId}-label`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = useRef(null);
  const listRef = useRef(null);

  const selectedIndex = options.findIndex((o) => String(o.value) === String(value));
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  // Close on a pointer press anywhere outside the control.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Keep the active option in view inside the list's own scroll box only —
  // `block: 'nearest'` never scrolls the page.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const openList = (index = selectedIndex >= 0 ? selectedIndex : 0) => {
    if (disabled || options.length === 0) return;
    setActiveIndex(index);
    setOpen(true);
  };

  const choose = (index) => {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    const last = options.length - 1;
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
      case ' ':
        e.preventDefault();
        if (open) choose(activeIndex);
        else openList();
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          setOpen(false);
        }
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        // Type-ahead: jump to the next option starting with the typed letter.
        if (e.key.length === 1 && /\S/.test(e.key)) {
          const letter = e.key.toLowerCase();
          const start = open ? activeIndex : selectedIndex;
          for (let step = 1; step <= options.length; step += 1) {
            const index = (start + step + options.length) % options.length;
            if (String(options[index].label).toLowerCase().startsWith(letter)) {
              if (open) setActiveIndex(index);
              else onChange(options[index].value);
              break;
            }
          }
        }
    }
  };

  return (
    <div className={`dropdown${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`} ref={wrapRef}>
      {label && (
        <span className="dropdown__label" id={labelId}>
          {label}
        </span>
      )}
      <button
        type="button"
        id={baseId}
        className="dropdown__trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={label ? `${labelId} ${baseId}` : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${baseId}-opt-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        <span className={`dropdown__value${selected ? '' : ' is-placeholder'}`}>
          {selected ? selected.label : placeholder}
          {selected?.meta && <span className="dropdown__meta">{selected.meta}</span>}
        </span>
        <FiChevronDown className="dropdown__caret" aria-hidden="true" />
      </button>
      {open && (
        <ul className="dropdown__list" id={listId} role="listbox" aria-labelledby={label ? labelId : undefined} ref={listRef}>
          {options.map((option, index) => {
            const isSelected = index === selectedIndex;
            return (
              <li
                key={option.value}
                id={`${baseId}-opt-${index}`}
                role="option"
                aria-selected={isSelected}
                className={`dropdown__option${index === activeIndex ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}`}
                // pointerdown + preventDefault keeps focus on the trigger, so
                // keyboard users and screen readers stay in the combobox.
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
      )}
    </div>
  );
}
