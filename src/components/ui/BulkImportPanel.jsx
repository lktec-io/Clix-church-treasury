import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FiUpload, FiDownload, FiFile, FiX, FiCheckCircle, FiAlertTriangle } from 'react-icons/fi';
import { contributorsApi } from '../../api/endpoints.js';
import { unwrapApiError } from '../../api/client.js';
import { useLocale } from '../../i18n/LocaleContext.jsx';
import { useToast } from '../Toast.jsx';

// Bulk member import: download a template, fill it in Excel, drop it back.
//
// The file is read in the browser and sent base64-encoded in the JSON body
// (see contributorsApi.bulkImport) — the server has no multipart parser, and
// this is the only upload in the product. FileReader's data: URL is
// "data:<mime>;base64,<payload>"; everything after the comma is what the
// API wants.
const MAX_FILE_BYTES = 700 * 1024; // ~1MB once base64 inflates it — express.json's cap.
const ACCEPT = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read_failed'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(file);
  });
}

const panelVariants = {
  hidden: { opacity: 0, height: 0 },
  visible: { opacity: 1, height: 'auto', transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, height: 0, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } },
};

export default function BulkImportPanel({ open, onClose, onImported }) {
  const { t } = useLocale();
  const toast = useToast();
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const reset = () => {
    setFile(null);
    setError(null);
    setResult(null);
    setDragging(false);
  };

  const chooseFile = (candidate) => {
    setError(null);
    setResult(null);
    if (!candidate) return;
    if (candidate.size > MAX_FILE_BYTES) {
      setError(t('contributors.import.tooLarge'));
      return;
    }
    setFile(candidate);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    chooseFile(e.dataTransfer.files?.[0]);
  };

  const handleDownloadTemplate = async () => {
    setError(null);
    try {
      await contributorsApi.downloadImportTemplate();
    } catch (err) {
      setError(unwrapApiError(err).message);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const base64 = await readAsBase64(file);
      const data = await contributorsApi.bulkImport(file.name, base64);
      setResult(data);
      setFile(null);
      // The directory behind this panel is now stale regardless of how many
      // rows were skipped, so refresh on any successful response.
      await onImported();
      if (data.imported > 0) toast.success(t('contributors.import.done', { count: data.imported }));
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    reset();
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div variants={panelVariants} initial="hidden" animate="visible" exit="exit" style={{ overflow: 'hidden' }}>
          <div className="card">
            <div className="card__header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FiUpload aria-hidden="true" /> {t('contributors.import.title')}
              </h2>
              <button type="button" className="btn btn--secondary btn--sm" onClick={close}>
                <FiX aria-hidden="true" /> {t('common.cancel')}
              </button>
            </div>

            <p className="field-hint" style={{ margin: '0 0 14px' }}>{t('contributors.import.hint')}</p>

            <div className="form-actions" style={{ marginTop: 0, marginBottom: 14 }}>
              <button type="button" className="btn btn--secondary btn--sm" onClick={handleDownloadTemplate}>
                <FiDownload aria-hidden="true" /> {t('contributors.import.downloadTemplate')}
              </button>
            </div>

            {error && <div className="alert alert--error">{error}</div>}

            {/* Drop zone. It is a <button> rather than a <div onClick>, so
                keyboard and screen-reader users reach it the same way a
                mouse user does — a file picker behind a non-focusable div
                is simply unavailable to them. */}
            <motion.button
              type="button"
              className={`dropzone${dragging ? ' is-dragging' : ''}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              animate={{ scale: dragging ? 1.01 : 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            >
              <motion.span
                className="dropzone__icon"
                animate={{ y: dragging ? -3 : 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              >
                {file ? <FiFile aria-hidden="true" /> : <FiUpload aria-hidden="true" />}
              </motion.span>
              <span className="dropzone__label">
                {file ? file.name : t('contributors.import.dropzone')}
              </span>
              <span className="dropzone__meta">{t('contributors.import.accepts')}</span>
            </motion.button>

            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              hidden
              onChange={(e) => {
                chooseFile(e.target.files?.[0]);
                // Reset so re-picking the SAME file after a failed import
                // still fires a change event.
                e.target.value = '';
              }}
            />

            <div className="form-actions">
              <button type="button" className="btn btn--primary" onClick={handleUpload} disabled={!file || busy}>
                {busy ? t('contributors.import.importing') : t('contributors.import.submit')}
              </button>
              {file && !busy && (
                <button type="button" className="btn btn--secondary" onClick={() => setFile(null)}>
                  {t('common.cancel')}
                </button>
              )}
            </div>

            {/* Every row is accounted for: imported, or skipped with a
                reason. A silent "12 imported" against a 20-row file leaves a
                clerk with no idea what happened to the other eight. */}
            {result && (
              <motion.div
                className="import-summary"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="import-summary__head">
                  <FiCheckCircle aria-hidden="true" className="import-summary__ok" />
                  {t('contributors.import.summary', { imported: result.imported, total: result.totalRows })}
                </div>
                {result.skipped.length > 0 && (
                  <ul className="import-summary__list">
                    {result.skipped.map((row) => (
                      <li key={row.rowNumber}>
                        <FiAlertTriangle aria-hidden="true" />
                        {t('contributors.import.skippedRow', {
                          row: row.rowNumber,
                          name: row.name ?? '—',
                          reason: t(`contributors.import.reason.${row.reason}`),
                        })}
                      </li>
                    ))}
                  </ul>
                )}
              </motion.div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
