// Extensible by design: `payment_method` is a plain VARCHAR(50) column, not a
// DB ENUM, specifically so a new method can be added here — no migration
// needed. This list is the validation source of truth for both contributions
// (Phase 4) and expenses (Phase 5).
export const PAYMENT_METHODS = ['cash', 'bank', 'mobile_money', 'cheque', 'other'];

export function isValidPaymentMethod(value) {
  return PAYMENT_METHODS.includes(value);
}
