import * as contributorsService from './contributors.service.js';
import { validateCreateContributor } from './contributors.validator.js';
import { validationError } from '../../errors/AppError.js';
import { getMonthlyStatement, validateYearMonth } from '../contributions/statement.service.js';
import { renderStatementPdf } from '../contributions/statementPdf.js';
import { tenantsRepository } from '../tenants/tenants.repository.js';
import { churchSettingsRepository } from '../tenants/churchSettings.repository.js';
import { categoriesRepository } from '../categories/categories.repository.js';
import { formatMoney } from '../financial/moneyFormat.js';
import { sendSms } from '../sms/sms.service.js';
import { enablePortalAccess, resetPin } from '../memberAuth/enrollment.service.js';

export async function list(req, res, next) {
  try {
    const contributors = await contributorsService.listContributors(req.tenantId);
    res.json({ success: true, data: contributors });
  } catch (err) {
    next(err);
  }
}

export async function get(req, res, next) {
  try {
    const contributor = await contributorsService.getContributor(req.tenantId, req.params.id);
    res.json({ success: true, data: contributor });
  } catch (err) {
    next(err);
  }
}

export async function create(req, res, next) {
  try {
    const data = validateCreateContributor(req.body ?? {});
    const contributor = await contributorsService.createContributor(req.tenantId, data);
    res.status(201).json({ success: true, data: contributor });
  } catch (err) {
    next(err);
  }
}

// Treasurer-facing side of the monthly statement (client spec §10): pick a
// contributor + month/year, view/download/send it. The member-portal
// equivalent (member.controller.js) calls the exact same
// getMonthlyStatement, always scoped to req.contributorId instead of a
// URL param.
export async function statement(req, res, next) {
  try {
    const { year, month } = validateYearMonth(req.query.year, req.query.month);
    const contributor = await contributorsService.getContributor(req.tenantId, req.params.id);
    const data = await getMonthlyStatement(req.tenantId, contributor.id, year, month);
    res.json({ success: true, data: { ...data, contributor } });
  } catch (err) {
    next(err);
  }
}

export async function statementPdf(req, res, next) {
  try {
    const { year, month } = validateYearMonth(req.query.year, req.query.month);
    const contributor = await contributorsService.getContributor(req.tenantId, req.params.id);
    const statementData = await getMonthlyStatement(req.tenantId, contributor.id, year, month);
    const [tenant, churchSettings, categories] = await Promise.all([
      tenantsRepository.findById(req.tenantId),
      churchSettingsRepository.findByTenantId(req.tenantId),
      categoriesRepository.findAllByTenant(req.tenantId),
    ]);
    const categoriesById = new Map(categories.map((c) => [c.id, c.name]));
    const locale = req.query.locale === 'sw' ? 'sw' : contributor.locale ?? tenant?.locale_default ?? 'en';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="statement-${contributor.member_number ?? contributor.id}-${year}-${month}.pdf"`
    );
    renderStatementPdf({ tenant, churchSettings, contributor, ...statementData, categoriesById }, res, locale);
  } catch (err) {
    next(err);
  }
}

export async function sendStatementSms(req, res, next) {
  try {
    const { year, month } = validateYearMonth(req.body?.year, req.body?.month);
    const contributor = await contributorsService.getContributor(req.tenantId, req.params.id);
    if (!contributor.phone) {
      throw validationError('Contributor has no phone number on file', { phone: 'required' });
    }
    const statementData = await getMonthlyStatement(req.tenantId, contributor.id, year, month);
    const tenant = await tenantsRepository.findById(req.tenantId);
    const sms = await sendSms(req.tenantId, {
      contributorId: contributor.id,
      phone: contributor.phone,
      templateKey: 'monthly_statement',
      locale: contributor.locale ?? tenant?.locale_default ?? 'en',
      params: {
        churchName: tenant?.name,
        memberName: contributor.full_name,
        month: `${String(month).padStart(2, '0')}-${year}`,
        tithe: formatMoney(statementData.tithe),
        offering: formatMoney(statementData.offering),
        other: formatMoney(statementData.other),
        total: formatMoney(statementData.total),
      },
      relatedType: 'contributor_statement',
      relatedId: contributor.id,
    });
    res.json({ success: true, data: { sms } });
  } catch (err) {
    next(err);
  }
}

export async function enablePortal(req, res, next) {
  try {
    const result = await enablePortalAccess(req.tenantId, req.params.id, req.auth.userId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function resetContributorPin(req, res, next) {
  try {
    const result = await resetPin(req.tenantId, req.params.id, req.auth.userId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}
