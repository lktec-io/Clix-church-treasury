// Validation rules only — no storage integration yet. Cloudinary (or
// equivalent) isn't provisioned until Phase 7 (docs/PROJECT_ARCHITECTURE.md
// §8), so there is no upload endpoint in this phase. This function exists so
// that when Phase 7 wires real storage, it reuses this validation rather
// than inventing its own — and so `expenses.validator.js` can already reject
// an attachment payload that wouldn't pass, ahead of storage existing.
//
// Deliberately does not trust the client-reported MIME type alone — callers
// must also check the actual file signature/magic bytes once real file
// bytes are available (Phase 7); this only validates the metadata shape.
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

export function validateAttachmentMetadata({ mime, sizeBytes }) {
  const errors = {};
  if (!ALLOWED_MIME_TYPES.includes(mime)) {
    errors.attachmentMime = `must be one of: ${ALLOWED_MIME_TYPES.join(', ')}`;
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_SIZE_BYTES) {
    errors.attachmentSizeBytes = `must be a positive integer no greater than ${MAX_SIZE_BYTES} bytes`;
  }
  return errors;
}
