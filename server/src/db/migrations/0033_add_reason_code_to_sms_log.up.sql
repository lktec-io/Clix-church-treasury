-- Persists the machine-readable failure category (auth / bad_request /
-- rate_limited / timeout / network / invalid_phone / provider_error /
-- provider_rejected — see server/src/modules/sms/providers/beemProvider.js
-- and sms.service.js) alongside the existing free-text error_message, so
-- "why did SMS fail" can be queried/aggregated (e.g. "how many failures
-- this week were auth vs rate-limiting") without parsing prose.
ALTER TABLE sms_log
  ADD COLUMN reason_code VARCHAR(50) NULL AFTER status;
