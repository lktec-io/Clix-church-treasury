import { forbidden } from '../../errors/AppError.js';
import { contributionsRepository } from '../contributions/contributions.repository.js';
import { categoriesRepository } from '../categories/categories.repository.js';
import { getMonthlyStatement, getYearlyTotal, validateYearMonth } from '../contributions/statement.service.js';
import { renderStatementPdf } from '../contributions/statementPdf.js';
import { getReceiptRenderData } from '../receipts/receipts.service.js';
import { renderReceiptPdf } from '../receipts/receiptPdf.js';
import { tenantsRepository } from '../tenants/tenants.repository.js';
import { churchSettingsRepository } from '../tenants/churchSettings.repository.js';
import { contributorsRepository } from '../contributors/contributors.repository.js';

// Every handler in this controller filters strictly by req.contributorId
// (set by memberContext.js from the verified JWT, never from a URL param)
// — this is the concrete backend enforcement of "a member can only ever
// see their own data," the central security requirement of the whole
// portal (docs/MASTER_TODO.md's member-portal plan §7).

export async function listContributions(req, res, next) {
  try {
    const limit = req.query.limit ? Math.min(Number(req.query.limit), 200) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const [contributions, categories] = await Promise.all([
      contributionsRepository.search(req.tenantId, {
        contributorId: req.contributorId,
        dateFrom: req.query.dateFrom || undefined,
        dateTo: req.query.dateTo || undefined,
        limit,
        offset,
      }),
      categoriesRepository.findAllByTenant(req.tenantId),
    ]);
    const categoriesById = new Map(categories.map((c) => [c.id, c.name]));
    const data = contributions.map((c) => ({ ...c, category_name: categoriesById.get(c.category_id) ?? null }));
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function statement(req, res, next) {
  try {
    const { year, month } = validateYearMonth(req.query.year, req.query.month);
    const data = await getMonthlyStatement(req.tenantId, req.contributorId, year, month);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function yearTotal(req, res, next) {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const data = await getYearlyTotal(req.tenantId, req.contributorId, year);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function statementPdf(req, res, next) {
  try {
    const { year, month } = validateYearMonth(req.query.year, req.query.month);
    const [statementData, tenant, churchSettings, categories] = await Promise.all([
      getMonthlyStatement(req.tenantId, req.contributorId, year, month),
      tenantsRepository.findById(req.tenantId),
      churchSettingsRepository.findByTenantId(req.tenantId),
      categoriesRepository.findAllByTenant(req.tenantId),
    ]);
    const contributor = await contributorsRepository.findById(req.tenantId, req.contributorId);
    const categoriesById = new Map(categories.map((c) => [c.id, c.name]));
    const locale = req.query.locale === 'sw' ? 'sw' : contributor?.locale ?? tenant?.locale_default ?? 'en';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="statement-${year}-${month}.pdf"`);
    renderStatementPdf({ tenant, churchSettings, contributor, ...statementData, categoriesById }, res, locale);
  } catch (err) {
    next(err);
  }
}

export async function receiptPdf(req, res, next) {
  try {
    const data = await getReceiptRenderData(req.tenantId, req.params.id, { canViewContributors: true });
    if (data.contribution.contributor_id !== req.contributorId) {
      throw forbidden('This receipt does not belong to you');
    }
    const locale = req.query.locale === 'sw' ? 'sw' : data.tenant.locale_default === 'sw' ? 'sw' : 'en';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${data.receipt.receipt_number}.pdf"`);
    renderReceiptPdf(data, res, locale);
  } catch (err) {
    next(err);
  }
}
