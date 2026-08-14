-- Mirrors refresh_tokens (0009_create_refresh_tokens.up.sql) exactly, but
-- for the member-portal subject type (contributors), never users. Kept as
-- its own table rather than adding a nullable contributor_id to
-- refresh_tokens — that would turn one clean NOT NULL FK into an XOR
-- constraint enforced only in application code, for two subject types that
-- must never be confusable (server/src/modules/memberAuth/memberTokens.js
-- verifies a `kind: 'member'` claim independently of this table too).
CREATE TABLE contributor_refresh_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  contributor_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  replaced_by_token_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_contributor_refresh_tokens_hash (token_hash),
  KEY idx_contributor_refresh_tokens_contributor (contributor_id),
  CONSTRAINT fk_contributor_refresh_tokens_contributor FOREIGN KEY (contributor_id) REFERENCES contributors (id) ON DELETE CASCADE,
  CONSTRAINT fk_contributor_refresh_tokens_replaced_by FOREIGN KEY (replaced_by_token_id) REFERENCES contributor_refresh_tokens (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
