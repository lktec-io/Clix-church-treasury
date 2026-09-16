import { useId } from 'react';
import {
  FiAlertOctagon,
  FiCreditCard,
  FiFileText,
  FiInfo,
  FiLock,
  FiMinus,
  FiNavigation,
  FiShield,
  FiUserX,
} from 'react-icons/fi';
import { useLocale } from '../../i18n/LocaleContext.jsx';
import { NIDA_LENGTH, normalizeNida } from '../../utils/memberId.js';
import { identityError } from '../../utils/memberIdentityForm.js';
import ChoiceTiles from './ChoiceTiles.jsx';

// Birth date as a UTC calendar date (the NIN's first eight digits), plus the
// holder's age today. Only called once the number has passed validation, so
// the date is known to be real and not in the future.
function nidaBirthFacts(idNumber, now = new Date()) {
  const digits = normalizeNida(idNumber);
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6)) - 1;
  const day = Number(digits.slice(6, 8));
  const birth = new Date(Date.UTC(year, month, day));
  let age = now.getUTCFullYear() - year;
  if (now.getUTCMonth() < month || (now.getUTCMonth() === month && now.getUTCDate() < day)) age -= 1;
  return {
    date: birth.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }),
    age,
    // The grouping printed on the physical card: YYYYMMDD-XXXXX-XXXXX-XX.
    grouped: `${digits.slice(0, 8)}-${digits.slice(8, 13)}-${digits.slice(13, 18)}-${digits.slice(18)}`,
  };
}

/**
 * Identity-document block for member registration.
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
  const verified = value.idType === 'nida' && !error ? nidaBirthFacts(value.idNumber) : null;

  const documentOptions = [
    { value: '', label: t('memberId.type.unset'), icon: FiMinus },
    { value: 'nida', label: t('memberId.type.nida'), meta: t('memberId.type.nida.meta'), icon: FiCreditCard },
    { value: 'voter_id', label: t('memberId.type.voter_id'), icon: FiFileText },
    { value: 'driving_licence', label: t('memberId.type.driving_licence'), icon: FiNavigation },
    { value: 'none', label: t('memberId.type.none'), icon: FiUserX },
  ];

  return (
    <fieldset className="id-fieldset">
      <legend className="id-fieldset__legend">
        <FiShield aria-hidden="true" /> {t('memberId.title')}
      </legend>

      <div className="id-fieldset__body">
        <ChoiceTiles
          legend={t('memberId.type')}
          options={documentOptions}
          value={value.idType}
          // Switching type clears the number: a voter ID left in a NIDA field
          // would otherwise surface as a confusing "digits only" error.
          onChange={(idType) => onChange({ idType, idNumber: '', idNote: '' })}
        />

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
            <div className="id-digit-meter">
              <div className="id-digit-meter__track" aria-hidden="true">
                {Array.from({ length: NIDA_LENGTH }, (_, i) => (
                  <span key={i} className={`id-digit-meter__cell${i < digits.length ? ' is-filled' : ''}`} />
                ))}
              </div>
              <span id={`${baseId}-count`} className="field-hint tabular-nums">
                {t('memberId.nida.count', { count: digits.length, length: NIDA_LENGTH })}
              </span>
            </div>
          </div>
        )}

        {(value.idType === 'voter_id' || value.idType === 'driving_licence') && (
          <div className="field">
            <label htmlFor={`${baseId}-doc`}>{t(`memberId.number.${value.idType}`)}</label>
            <input
              id={`${baseId}-doc`}
              className="id-input--nida"
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
          <div className="field">
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

        {visibleError && (
          <div id={errorId} className="id-alert" role="alert">
            <FiAlertOctagon className="id-alert__icon" aria-hidden="true" />
            <div>
              <div className="id-alert__title">{t('memberId.error.title')}</div>
              <div className="id-alert__message">{visibleError}</div>
            </div>
          </div>
        )}

        {verified && (
          <section className="id-card" role="status" aria-label={t('memberId.card.title')}>
            <div className="id-card__head">
              <span className="id-card__title">
                <FiShield aria-hidden="true" /> {t('memberId.card.title')}
              </span>
              <span className="id-card__seal">
                <FiLock aria-hidden="true" /> {t('memberId.card.readOnly')}
              </span>
            </div>
            <dl className="id-card__body">
              <div>
                <dt>{t('memberId.card.birthDate')}</dt>
                <dd>{verified.date}</dd>
              </div>
              <div>
                <dt>{t('memberId.card.age')}</dt>
                <dd className="tabular-nums">{t('memberId.card.ageValue', { years: verified.age })}</dd>
              </div>
              <div>
                <dt>{t('memberId.card.nin')}</dt>
                <dd className="is-mono">{verified.grouped}</dd>
              </div>
            </dl>
            {/* Stated on the card itself: a format check is not a lookup. */}
            <p className="id-card__foot">
              <FiInfo aria-hidden="true" /> {t('memberId.card.note')}
            </p>
          </section>
        )}
      </div>
    </fieldset>
  );
}
