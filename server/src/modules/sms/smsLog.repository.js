import { TenantScopedRepository } from '../../db/TenantScopedRepository.js';

class SmsLogRepository extends TenantScopedRepository {
  constructor() {
    super('sms_log');
  }
}

export const smsLogRepository = new SmsLogRepository();
