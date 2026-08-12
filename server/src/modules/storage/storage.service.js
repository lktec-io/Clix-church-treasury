import { AppError } from '../../errors/AppError.js';

// The storage contract every future caller (expense attachments, and
// nothing else — this is not a document management system) will use, once a
// real provider is wired up. Deliberately built now, ahead of Cloudinary
// being provisioned, so the interface is stable and callers don't need to
// change when storage integration lands — only this file's implementation does.
//
// STATUS: PENDING. No Cloudinary account exists yet
// (docs/PROJECT_ARCHITECTURE.md §8 Open Items). Every method below throws a
// clear, typed error rather than silently doing nothing or faking success.
// Do not ask for Cloudinary credentials — wire the real implementation in
// when the account is provisioned.

function notConfigured() {
  return new AppError(
    'STORAGE_NOT_CONFIGURED',
    'File storage is not configured yet — this capability is pending Cloudinary provisioning',
    { status: 501 }
  );
}

/**
 * @param {{ buffer: Buffer, mimeType: string, sizeBytes: number, tenantId: number }} file
 * @returns {Promise<{ url: string, publicId: string }>}
 */
export async function uploadFile(_file) {
  throw notConfigured();
}

/**
 * @param {string} publicId
 * @returns {Promise<string>} a time-limited, authenticated URL — never a
 * bare public one, so tenant isolation holds for stored files too
 * (docs/SECURITY_ARCHITECTURE.md §6).
 */
export async function getSignedUrl(_publicId) {
  throw notConfigured();
}

/**
 * @param {string} publicId
 */
export async function deleteFile(_publicId) {
  throw notConfigured();
}

export function isStorageConfigured() {
  return false;
}
