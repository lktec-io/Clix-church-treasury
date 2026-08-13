import { validationError } from '../../errors/AppError.js';
import { isValidPaymentMethod, PAYMENT_METHODS } from '../financial/paymentMethods.js';
import { isPositiveMoneyString } from '../financial/money.js';
import { validateAttachmentMetadata } from './attachmentValidation.js';

export function validateCreateExpense(body) {
  const fields = {};

  if (!isPositiveMoneyString(body.amount)) {
    fields.amount = 'must be a positive decimal string with at most 2 places, e.g. "100.50"';
  }
  if (!Number.isInteger(body.categoryId)) fields.categoryId = 'categoryId is required';
  if (!Number.isInteger(body.fundId)) fields.fundId = 'fundId is required';
  if (!Number.isInteger(body.accountId)) fields.accountId = 'accountId is required';
  if (typeof body.payee !== 'string' || body.payee.trim().length === 0) fields.payee = 'payee is required';
  else if (body.payee.length > 255) fields.payee = 'must be at most 255 characters';
  if (!isValidPaymentMethod(body.paymentMethod)) {
    fields.paymentMethod = `must be one of: ${PAYMENT_METHODS.join(', ')}`;
  }
  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== 'string') fields.description = 'must be a string';
    else if (body.description.length > 500) fields.description = 'must be at most 500 characters';
  }
  if (body.reference !== undefined && body.reference !== null) {
    if (typeof body.reference !== 'string') fields.reference = 'must be a string';
    else if (body.reference.length > 100) fields.reference = 'must be at most 100 characters';
  }

  let attachment = null;
  if (body.attachment) {
    const attachmentErrors = validateAttachmentMetadata(body.attachment);
    Object.assign(fields, attachmentErrors);
    if (Object.keys(attachmentErrors).length === 0) {
      attachment = { mime: body.attachment.mime, sizeBytes: body.attachment.sizeBytes };
    }
  }

  if (Object.keys(fields).length > 0) {
    throw validationError('Invalid expense payload', fields);
  }

  return {
    amount: body.amount,
    categoryId: body.categoryId,
    fundId: body.fundId,
    accountId: body.accountId,
    payee: body.payee.trim(),
    description: body.description?.trim() || null,
    paymentMethod: body.paymentMethod,
    reference: body.reference?.trim() || null,
    attachment,
  };
}

export function validateRejectExpense(body) {
  if (typeof body?.reason !== 'string' || body.reason.trim().length === 0) {
    throw validationError('Invalid payload', { reason: 'a reason is required to reject an expense' });
  }
  if (body.reason.length > 500) {
    throw validationError('Invalid payload', { reason: 'must be at most 500 characters' });
  }
  return { reason: body.reason.trim() };
}
