import { useId } from 'react';
import { FiCheck } from 'react-icons/fi';

/**
 * A flat, full-label radio group. Used instead of a native <select> where
 * the options are few and their names must never be cut off (identity
 * document type, church department).
 *
 * Each tile wraps a real radio input, so arrow-key movement, form semantics
 * and screen-reader grouping all come from the browser rather than being
 * re-implemented.
 *
 * options: [{ value, label, meta?, icon? }]  — value is compared as a string.
 */
export default function ChoiceTiles({ legend, options, value, onChange, name }) {
  const autoName = useId();
  const groupName = name ?? autoName;

  return (
    <fieldset className="choice-group">
      {legend && <legend className="choice-group__legend">{legend}</legend>}
      <div className="choice-grid">
        {options.map((option) => {
          const checked = String(value) === String(option.value);
          const Icon = option.icon;
          return (
            <label key={option.value} className={`choice-tile${checked ? ' is-checked' : ''}`}>
              <input
                type="radio"
                name={groupName}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
              />
              <span className="choice-tile__check" aria-hidden="true">
                <FiCheck />
              </span>
              {Icon && (
                <span className="choice-tile__icon" aria-hidden="true">
                  <Icon />
                </span>
              )}
              <span className="choice-tile__label">
                {option.label}
                {option.meta && <span className="choice-tile__meta">{option.meta}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
