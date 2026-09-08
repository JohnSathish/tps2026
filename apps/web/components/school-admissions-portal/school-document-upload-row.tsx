'use client';

import { useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  Eye,
  FileText,
  IndianRupee,
  RefreshCw,
  ScrollText,
  Trash2,
  Upload,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { Button } from '@/components/ui/button';
import { downloadSchoolOwnDocument } from '@/services/school-admissions';
import { apiErrorMessage } from '@/utils/api-error';
import { schoolDocumentDisplayStatus } from '@/lib/school-document-display-status';
import {
  SCHOOL_UPLOAD_ACCEPT_ATTR,
  SCHOOL_UPLOAD_FORMAT_HELP,
  SCHOOL_UPLOAD_MAX_PAGES_PER_SLOT,
  isSchoolMultiPageEligibleSlot,
  schoolDocumentPageSlotCode,
  validateSchoolUploadImageFile,
} from '@/lib/school-upload-image';

export type SchoolDocSlotView = {
  code: string;
  label: string;
  required: boolean;
  optional?: boolean;
  hint?: string;
  description: string;
};

export type SchoolDocUploaded = {
  id: string;
  slotCode: string;
  fileUrl: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  verificationStatus: string;
  createdAt?: string;
  updatedAt?: string;
};

const SLOT_ICONS: Record<string, typeof Camera> = {
  PHOTO: Camera,
  BIRTH_CERT: FileText,
  CASTE_CERT: ScrollText,
  MOTHER_ST_CERT: ScrollText,
  FATHER_SC_OBC_CERT: ScrollText,
  LAST_SCHOOL_REPORT: FileText,
  LAST_SCHOOL_CERT: ScrollText,
  FATHER_INCOME: IndianRupee,
  MOTHER_INCOME: IndianRupee,
};

const DEFAULT_DESCRIPTIONS: Record<string, string> = {
  PHOTO: 'Recent passport-size photo in school uniform (JPG or PNG).',
  BIRTH_CERT:
    'Clear photo of the original birth certificate of the child (not a parent’s birth certificate).',
  CASTE_CERT:
    'Required for General / UR candidates. Please upload a clear copy of the caste certificate issued by a competent authority so the school can verify the category.',
  MOTHER_ST_CERT:
    'Required for Garo, Khasi and Jaintia candidates. Please upload a clear copy of the mother’s original Scheduled Tribe certificate.',
  FATHER_SC_OBC_CERT:
    'Required for SC or OBC candidates. Please upload a clear copy of the father’s original SC or OBC certificate, as applicable.',
  LAST_SCHOOL_REPORT: 'Latest report card or progress sheet from the previous school.',
  LAST_SCHOOL_CERT: 'Transfer / leaving certificate or school certificate.',
  FATHER_INCOME: 'Father’s income certificate from a competent authority.',
  MOTHER_INCOME: 'Mother’s income certificate from a competent authority.',
};

export function schoolDocSlotDescription(code: string, hint?: string) {
  return hint || DEFAULT_DESCRIPTIONS[code] || SCHOOL_UPLOAD_FORMAT_HELP;
}

function formatBytes(size?: number | null) {
  if (!size || size <= 0) return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function fileNameFromUrl(url: string) {
  try {
    const path = url.split('?')[0] ?? url;
    return decodeURIComponent(path.split('/').pop() || 'document');
  } catch {
    return 'document';
  }
}

function formatUploadedOn(iso?: string) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function SchoolDocumentUploadRow({
  slot,
  uploaded,
  extraPages = [],
  readOnly,
  busy,
  onUpload,
  onRemove,
  onRemovePage,
}: {
  slot: SchoolDocSlotView;
  uploaded?: SchoolDocUploaded | null;
  /** Extra page images for multi-page certificates (__p2…)。 */
  extraPages?: SchoolDocUploaded[];
  readOnly?: boolean;
  busy?: boolean;
  onUpload: (files: File[], mode: 'replace' | 'addPage') => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
  onRemovePage?: (slotCode: string) => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const addPageRef = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const Icon = SLOT_ICONS[slot.code] ?? FileText;
  const canEdit = !readOnly;
  const multiPage = isSchoolMultiPageEligibleSlot(slot.code);
  const uploadedOn = formatUploadedOn(uploaded?.updatedAt || uploaded?.createdAt);
  const sizeLabel = formatBytes(uploaded?.sizeBytes);
  const statusDisplay = schoolDocumentDisplayStatus({
    uploaded: Boolean(uploaded),
    verificationStatus: uploaded?.verificationStatus,
  });
  const canAddPage =
    multiPage &&
    Boolean(uploaded) &&
    canEdit &&
    extraPages.length + 1 < SCHOOL_UPLOAD_MAX_PAGES_PER_SLOT;

  const pickFile = () => inputRef.current?.click();
  const pickAddPage = () => addPageRef.current?.click();

  const handleFiles = (list: FileList | null, mode: 'replace' | 'addPage') => {
    setLocalError(null);
    if (!list?.length) return;
    const files = Array.from(list);
    for (const file of files) {
      const err = validateSchoolUploadImageFile(file);
      if (err) {
        setLocalError(err);
        return;
      }
    }
    if (mode === 'addPage') {
      const room = SCHOOL_UPLOAD_MAX_PAGES_PER_SLOT - (1 + extraPages.length);
      void onUpload(files.slice(0, Math.max(0, room)), 'addPage');
      return;
    }
    if (!multiPage) {
      void onUpload([files[0]!], 'replace');
      return;
    }
    void onUpload(files.slice(0, SCHOOL_UPLOAD_MAX_PAGES_PER_SLOT), 'replace');
  };

  const onView = async (slotCode: string) => {
    setViewError(null);
    setViewing(true);
    try {
      const blob = await downloadSchoolOwnDocument(slotCode);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setViewError(apiErrorMessage(err));
    } finally {
      setViewing(false);
    }
  };

  return (
    <div className={cn('tps-doc-row', uploaded && 'is-uploaded')}>
      <div className="tps-doc-row-main">
        <span className="tps-doc-row-icon">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-slate-900">{slot.label}</p>
            {slot.required ? (
              <span className="tps-doc-badge is-required">Required</span>
            ) : (
              <span className="tps-doc-badge is-optional">Optional</span>
            )}
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
            {slot.description}
            <span className="text-slate-400"> · {SCHOOL_UPLOAD_FORMAT_HELP}</span>
          </p>
          {multiPage ? (
            <p className="mt-1 text-xs text-slate-500">
              Multi-page document? Upload up to {SCHOOL_UPLOAD_MAX_PAGES_PER_SLOT} clear JPG/PNG
              photos (one per page).
            </p>
          ) : null}

          {uploaded ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
              <span className="truncate font-mono text-xs text-slate-700 sm:text-sm">
                {fileNameFromUrl(uploaded.fileUrl)}
              </span>
              {sizeLabel ? <span className="text-xs text-slate-400">{sizeLabel}</span> : null}
              <span
                className={cn(
                  'inline-flex items-center gap-1 text-xs font-medium',
                  statusDisplay.tone === 'success'
                    ? 'text-emerald-700'
                    : statusDisplay.tone === 'danger'
                      ? 'text-rose-700'
                      : 'text-amber-800',
                )}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {statusDisplay.displayLabel}
                {uploadedOn ? ` · ${uploadedOn}` : ''}
              </span>
            </div>
          ) : (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-slate-300" />
                {statusDisplay.displayLabel}
              </span>
            </div>
          )}

          {extraPages.length ? (
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {extraPages.map((page) => (
                <li key={page.slotCode} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">Page {page.slotCode.split('__p')[1]}:</span>
                  <span className="font-mono">{fileNameFromUrl(page.fileUrl)}</span>
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void onView(page.slotCode)}
                  >
                    View
                  </button>
                  {canEdit && onRemovePage ? (
                    <button
                      type="button"
                      className="text-rose-700 underline"
                      onClick={() => void onRemovePage(page.slotCode)}
                    >
                      Remove
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {localError || viewError ? (
            <p className="mt-1 text-xs text-destructive" role="alert">
              {localError || viewError}
            </p>
          ) : null}
        </div>
      </div>

      <div className="tps-doc-row-actions">
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept={SCHOOL_UPLOAD_ACCEPT_ATTR}
          multiple={multiPage}
          disabled={!canEdit || busy}
          onChange={(e) => {
            handleFiles(e.target.files, 'replace');
            e.target.value = '';
          }}
        />
        <input
          ref={addPageRef}
          type="file"
          className="sr-only"
          accept={SCHOOL_UPLOAD_ACCEPT_ATTR}
          multiple
          disabled={!canAddPage || busy}
          onChange={(e) => {
            handleFiles(e.target.files, 'addPage');
            e.target.value = '';
          }}
        />

        {uploaded ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="tps-doc-action"
              disabled={viewing}
              onClick={() => void onView(uploaded.slotCode)}
            >
              <Eye className="h-3.5 w-3.5" />
              {viewing ? 'Opening…' : 'View'}
            </Button>
            {canEdit ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="tps-doc-action"
                  disabled={busy}
                  onClick={pickFile}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Replace
                </Button>
                {canAddPage ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="tps-doc-action"
                    disabled={busy}
                    onClick={pickAddPage}
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Add page
                  </Button>
                ) : null}
                {onRemove ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="tps-doc-action is-danger"
                    disabled={busy || removing}
                    onClick={() => {
                      setRemoving(true);
                      void Promise.resolve(onRemove()).finally(() => setRemoving(false));
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </Button>
                ) : null}
              </>
            ) : null}
          </>
        ) : canEdit ? (
          <Button
            type="button"
            size="sm"
            className="bg-[#1a5336] text-white hover:bg-[#15462d]"
            disabled={busy}
            onClick={pickFile}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Choose File
          </Button>
        ) : (
          <span className="text-xs text-slate-400">Locked</span>
        )}
      </div>
    </div>
  );
}

export { schoolDocumentPageSlotCode };
