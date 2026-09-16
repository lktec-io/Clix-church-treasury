import { useId } from 'react';
import { FiAlertOctagon, FiCheckCircle } from 'react-icons/fi';
import { useLocale } from '../../i18n/LocaleContext.jsx';
import { NIDA_LENGTH, normalizeNida, validateMemberIdentity, validateNida } from '../../utils/memberId.js';

export function emptyIdentity() {
  return { idType: '', idNumber: '', idNote: '' };
}

/**
 * Error message for the identity block, or null when it may be submitted.
 * Uses the same validator the server runs, so a form that passes here is not
 * rejected there for identity reasons.
 */
export function identityError(identity, t) {
  if (identity.idType === 'nida') {
    const result = validateNida(identity.idNumber);
    return result.valid ? null : t(`memberId.nida.error.${result.reason}`, { length: NIDA_LENGTH });
  }
  const { fields } = validateMemberIdentity(identity);
  if (fields.idNumber) return t('memberId.document.error');
  if (fields.idNote) return t('memberId.note.error');
  return null;
}

/** The body the API expects — empty values omitted rather than sent as ''. */
export function identityPayload(identity) {
  if (!identity.idType) return {};
  if (identity.idType === 'none') return { idType: 'none', idNote: identity.idNote.trim() || undefined };
  return { idType: identity.idType, idNumber: identity.idNumber };
}

// Only shown once the digits are complete — the birth date is what a
// treasurer can check against the member standing in front of them.
function nidaBirthDate(idNumber) {
  const digits = normalizeNida(idNumber);
  const date = new Date(Date.UTC(Number(digits.slice(0, 4)), Number(digits.slice(4, 6)) - 1, Number(digits.slice(6, 8))));
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Dynamic identity-document block for member registration.
 *
 * `showErrors` is raised by the parent on a submit attempt, so an untouched
 * form is not painted red; a NIDA number is also checked live as soon as it
 * reaches full length, which is when a typo becomes meaningful.
 */
export default function MemberIdentityFields({ value, onChange, showErrors }) {
  const { t } = useLocale();
  const baseId = useId();
  const set = (patch) => onChange({ ...value, ...patch });

  const digits = normalizeNida(value.idNumber);
  const error = identityError(value, t);
  const nidaComplete = value.idType === 'nida' && digits.length >= NIDA_LENGTH;
  const visibleError = error && (showErrors || nidaComplete) ? error : null;
  const errorId = `${baseId}-error`;

  return (
    <fieldset className="id-fieldset">
      <legend className="id-fieldset__legend">{t('memberId.title')}</legend>

      <div className="form-grid">
        <div className="field">
          <label htmlFor={`${baseId}-type`}>{t('memberId.type')}</label>
          <select
            id={`${baseId}-type`}
            value={value.idType}
            // Switching type clears the number: a voter ID left in a NIDA
            // field would otherwise surface as a confusing "digits only" error.
            onChange={(e) => onChange({ idType: e.target.value, idNumber: '', idNote: '' })}
          >
            <option value="">{t('memberId.type.unset')}</option>
            <option value="nida">{t('memberId.type.nida')}</option>
            <option value="voter_id">{t('memberId.type.voter_id')}</option>
            <option value="driving_licence">{t('memberId.type.driving_licence')}</option>
            <option value="none">{t('memberId.type.none')}</option>
          </select>
        </div>

        {value.idType === 'nida' && (
          <div className="field">
            <label htmlFor={`${baseId}-nida`}>{t('memberId.nida.label')}</label>
            <input
              id={`${baseId}-nida`}
              className="id-input--nida"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              // Room for the dashes people copy from the card.
              maxLength={NIDA_LENGTH + 6}
              placeholder="19900101-12345-00001-12"
              value={value.idNumber}
              onChange={(e) => set({ idNumber: e.target.value })}
              aria-invalid={Boolean(visibleError)}
              aria-describedby={visibleError ? errorId : `${baseId}-count`}
            />
            <span id={`${baseId}-count`} className="field-hint">
              {t('memberId.nida.count', { count: digits.length, length: NIDA_LENGTH })}
            </span>
          </div>
        )}

        {(value.idType === 'voter_id' || value.idType === 'driving_licence') && (
          <div className="field">
            <label htmlFor={`${baseId}-doc`}>{t(`memberId.number.${value.idType}`)}</label>
            <input
              id={`${baseId}-doc`}
              autoComplete="off"
              spellCheck={false}
              maxLength={30}
              value={value.idNumber}
              onChange={(e) => set({ idNumber: e.target.value })}
              aria-invalid={Boolean(visibleError)}
              aria-describedby={visibleError ? errorId : undefined}
            />
          </div>
        )}

        {value.idType === 'none' && (
          <div className="field field--full">
            <label htmlFor={`${baseId}-note`}>{t('memberId.note.label')}</label>
            <input
              id={`${baseId}-note`}
              maxLength={255}
              placeholder={t('memberId.note.placeholder')}
              value={value.idNote}
              onChange={(e) => set({ idNote: e.target.value })}
            />
          </div>
        )}
      </div>

      {visibleError && (
        <div id={errorId} className="id-alert" role="alert">
          <FiAlertOctagon aria-hidden="true" />
          <span>{visibleError}</span>
        </div>
      )}

      {value.idType === 'nida' && !error && (
        <div className="id-verified" role="status">
          <FiCheckCircle aria-hidden="true" />
          <span>{t('memberId.nida.valid', { date: nidaBirthDate(value.idNumber) })}</span>
        </div>
      )}
    </fieldset>
  );
}
