import { notFound } from '../../errors/AppError.js';
import { nowSql } from '../../db/time.js';
import { receiptsRepository } from './receipts.repository.js';
import { generateReceiptNumber } from './receiptNumber.js';
import { contributionsRepository } from '../contributions/contributions.repository.js';
import { transactionsRepository } from '../financial/transactions.repository.js';
import { tenantsRepository } from '../tenants/tenants.repository.js';
import { churchSettingsRepository } from '../tenants/churchSettings.repository.js';
import { accountsRepository } from '../accounts/accounts.repository.js';
import { fundsRepository } from '../funds/funds.repository.js';
import { categoriesRepository } from '../categories/categories.repository.js';
import { contributorsRepository } from '../contributors/contributors.repository.js';
import { usersRepository } from '../users/users.repository.js';

// Called from contributions.service.js#recordContribution, inside the same
// DB transaction — a contribution is never left without its receipt, and a
// receipt never exists without a real posted contribution behind it. One
// receipt architecture for every income source (docs/MASTER_TODO.md Phase 7)
// — pledge payments are contributions too, so they're covered automatically,
// no separate pledge-receipt code path.
export async function issueReceiptForContribution(tenantId, contributionId, actorUserId, connection) {
  const receiptNumber = await generateReceiptNumber(tenantId, connection);
  return receiptsRepository.insert(
    tenantId,
    {
      contribution_id: contributionId,
      receipt_number: receiptNumber,
      issued_by_user_id: actorUserId,
      issued_at: nowSql(),
    },
    connection
  );
}

export async function getReceipt(tenantId, id) {
  const receipt = await receiptsRepository.findById(tenantId, id);
  if (!receipt) throw notFound('Receipt not found');
  return receipt;
}

export async function getReceiptForContribution(tenantId, contributionId) {
  const receipt = await receiptsRepository.findByContributionId(tenantId, contributionId);
  if (!receipt) throw notFound('No receipt exists for this contribution');
  return receipt;
}

// Gathers everything the PDF renderer needs in one place — the renderer
// itself (receiptPdf.js) does no data access, only layout. Contributor
// identity is only attached when the caller holds contributors.view, same
// privacy boundary as everywhere else contributor data appears
// (docs/SECURITY_ARCHITECTURE.md §1).
export async function getReceiptRenderData(tenantId, receiptId, { canViewContributors }) {
  const receipt = await receiptsRepository.findById(tenantId, receiptId);
  if (!receipt) throw notFound('Receipt not found');

  const contribution = await contributionsRepository.findById(tenantId, receipt.contribution_id);
  if (!contribution) throw notFound('Contribution behind this receipt no longer exists');

  const [transaction, tenant, churchSettings, account, fund, category, issuedBy] = await Promise.all([
    transactionsRepository.findById(tenantId, contribution.transaction_id),
    tenantsRepository.findById(tenantId),
    churchSettingsRepository.findByTenantId(tenantId),
    accountsRepository.findById(tenantId, contribution.account_id),
    fundsRepository.findById(tenantId, contribution.fund_id),
    categoriesRepository.findById(tenantId, contribution.category_id),
    usersRepository.findById(tenantId, receipt.issued_by_user_id),
  ]);

  const contributor =
    canViewContributors && contribution.contributor_id
      ? await contributorsRepository.findById(tenantId, contribution.contributor_id)
      : null;

  return { receipt, contribution, transaction, tenant, churchSettings, account, fund, category, issuedBy, contributor };
}
