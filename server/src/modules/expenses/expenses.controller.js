import * as expensesService from './expenses.service.js';
import { validateCreateExpense, validateRejectExpense } from './expenses.validator.js';
import { validationError } from '../../errors/AppError.js';

function parseFilters(query) {
  const filters = {};
  if (query.status) filters.status = query.status;
  if (query.fundId) filters.fundId = Number(query.fundId);
  if (query.requestedByUserId) filters.requestedByUserId = Number(query.requestedByUserId);
  return filters;
}

export async function list(req, res, next) {
  try {
    const expenses = await expensesService.listExpenses(req.tenantId, parseFilters(req.query));
    res.json({ success: true, data: expenses });
  } catch (err) {
    next(err);
  }
}

export async function get(req, res, next) {
  try {
    const expense = await expensesService.getExpense(req.tenantId, req.params.id);
    res.json({ success: true, data: expense });
  } catch (err) {
    next(err);
  }
}

export async function create(req, res, next) {
  try {
    const data = validateCreateExpense(req.body ?? {});
    const expense = await expensesService.createExpense(req.tenantId, data, req.auth.userId);
    res.status(201).json({ success: true, data: expense });
  } catch (err) {
    next(err);
  }
}

export async function update(req, res, next) {
  try {
    const data = validateCreateExpense(req.body ?? {});
    // Only these fields are legitimately editable on a draft — never status
    // or any approval/payment metadata, which have their own endpoints.
    const updates = {
      category_id: data.categoryId,
      fund_id: data.fundId,
      account_id: data.accountId,
      amount: data.amount,
      payee: data.payee,
      description: data.description,
      payment_method: data.paymentMethod,
      reference: data.reference,
    };
    const expense = await expensesService.updateExpense(req.tenantId, req.params.id, updates, req.auth.userId);
    res.json({ success: true, data: expense });
  } catch (err) {
    next(err);
  }
}

export async function submit(req, res, next) {
  try {
    const expense = await expensesService.submitExpense(req.tenantId, req.params.id, req.auth.userId);
    res.json({ success: true, data: expense });
  } catch (err) {
    next(err);
  }
}

export async function approve(req, res, next) {
  try {
    const expense = await expensesService.approveExpense(req.tenantId, req.params.id, req.auth.userId);
    res.json({ success: true, data: expense });
  } catch (err) {
    next(err);
  }
}

export async function reject(req, res, next) {
  try {
    const { reason } = validateRejectExpense(req.body ?? {});
    const expense = await expensesService.rejectExpense(req.tenantId, req.params.id, reason, req.auth.userId);
    res.json({ success: true, data: expense });
  } catch (err) {
    next(err);
  }
}

export async function returnForCorrection(req, res, next) {
  try {
    if (typeof req.body?.reason !== 'string' || req.body.reason.trim().length === 0) {
      throw validationError('Invalid payload', { reason: 'a reason is required' });
    }
    const expense = await expensesService.returnForCorrection(
      req.tenantId,
      req.params.id,
      req.body.reason.trim(),
      req.auth.userId
    );
    res.json({ success: true, data: expense });
  } catch (err) {
    next(err);
  }
}

export async function pay(req, res, next) {
  try {
    const expense = await expensesService.payExpense(req.tenantId, req.params.id, req.auth.userId);
    res.json({ success: true, data: expense });
  } catch (err) {
    next(err);
  }
}
