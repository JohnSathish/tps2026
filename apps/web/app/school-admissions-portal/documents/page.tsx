'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, FileStack, Info, Save } from 'lucide-react';
import { SchoolApplicantNav } from '@/components/school-admissions-portal/school-applicant-nav';
import {
  SchoolDocumentUploadRow,
  schoolDocSlotDescription,
} from '@/components/school-admissions-portal/school-document-upload-row';
import { SchoolWorkflowStepper } from '@/components/school-admissions-portal/school-workflow-stepper';
import { useSchoolPortalBranding } from '@/components/school-admissions-portal/school-admissions-shell';
import { Button } from '@/components/ui/button';
import { useAuthQueryEnabled } from '@/hooks/use-auth';
import { resolveSchoolCasteCategory } from '@/lib/school-admission-category';
import {
  schoolApplicationProgress,
  schoolCertificateSlots,
} from '@/lib/school-application-progress';
import {
  SCHOOL_UPLOAD_FORMAT_HELP,
  SCHOOL_UPLOAD_MAX_PAGES_PER_SLOT,
  isSchoolMultiPageEligibleSlot,
  parseSchoolDocumentSlotCode,
  schoolDocumentPageSlotCode,
  validateSchoolUploadImageFile,
} from '@/lib/school-upload-image';
import { apiErrorMessage } from '@/utils/api-error';
import {
  fetchSchoolApplicantMe,
  removeSchoolDocument,
  uploadSchoolDocument,
} from '@/services/school-admissions';

export default function SchoolDocumentsPage() {
  const router = useRouter();
  const enabled = useAuthQueryEnabled();
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ['school-applicant-me'],
    queryFn: fetchSchoolApplicantMe,
    enabled,
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const docs = me.data?.application.documents ?? [];
  const readOnly = Boolean(me.data?.readOnly);
  const progress = schoolApplicationProgress(me.data);
  const branding = useSchoolPortalBranding();
  const certificateSlots = schoolCertificateSlots(
    me.data?.application.formData,
    docs.map((doc) => doc.slotCode),
    me.data?.settings?.documentRequirements,
  );
  const category = resolveSchoolCasteCategory(
    (me.data?.application.formData?.child ?? {}) as Record<string, unknown>,
  );
  const community =
    typeof (me.data?.application.formData?.child as { community?: unknown } | undefined)
      ?.community === 'string'
      ? String((me.data?.application.formData?.child as { community?: string }).community).trim()
      : '';

  const pct =
    progress.certificatesRequired > 0
      ? Math.round((progress.certificatesUploaded / progress.certificatesRequired) * 100)
      : 0;

  const pagesForBase = (baseCode: string) =>
    docs
      .map((d) => ({ doc: d, parsed: parseSchoolDocumentSlotCode(d.slotCode) }))
      .filter((x) => x.parsed?.baseCode === baseCode && (x.parsed?.page ?? 1) > 1)
      .sort((a, b) => a.parsed!.page - b.parsed!.page)
      .map((x) => x.doc);

  const onUpload = async (baseCode: string, files: File[], mode: 'replace' | 'addPage') => {
    setError(null);
    setNotice(null);
    for (const file of files) {
      const invalid = validateSchoolUploadImageFile(file);
      if (invalid) {
        setError(invalid);
        return;
      }
    }
    setBusySlot(baseCode);
    try {
      if (mode === 'addPage') {
        const existingPages = new Set(
          docs
            .map((d) => parseSchoolDocumentSlotCode(d.slotCode))
            .filter((p) => p?.baseCode === baseCode)
            .map((p) => p!.page),
        );
        let page = 2;
        for (const file of files) {
          while (existingPages.has(page) && page <= SCHOOL_UPLOAD_MAX_PAGES_PER_SLOT) {
            page += 1;
          }
          if (page > SCHOOL_UPLOAD_MAX_PAGES_PER_SLOT) break;
          await uploadSchoolDocument(schoolDocumentPageSlotCode(baseCode, page), file);
          existingPages.add(page);
          page += 1;
        }
      } else if (isSchoolMultiPageEligibleSlot(baseCode)) {
        const limited = files.slice(0, SCHOOL_UPLOAD_MAX_PAGES_PER_SLOT);
        for (let i = 0; i < limited.length; i += 1) {
          await uploadSchoolDocument(schoolDocumentPageSlotCode(baseCode, i + 1), limited[i]!);
        }
        for (const extra of pagesForBase(baseCode)) {
          const parsed = parseSchoolDocumentSlotCode(extra.slotCode);
          if (parsed && parsed.page > limited.length) {
            await removeSchoolDocument(extra.slotCode);
          }
        }
      } else {
        await uploadSchoolDocument(baseCode, files[0]!);
      }
      await queryClient.invalidateQueries({ queryKey: ['school-applicant-me'] });
      setNotice('Document uploaded successfully.');
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusySlot(null);
    }
  };

  const onRemove = async (slotCode: string) => {
    setError(null);
    setNotice(null);
    setBusySlot(slotCode);
    try {
      await removeSchoolDocument(slotCode);
      await queryClient.invalidateQueries({ queryKey: ['school-applicant-me'] });
      setNotice('Document removed.');
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusySlot(null);
    }
  };

  const saveDraft = () => {
    setError(null);
    setNotice(
      'Your uploaded documents are already saved. You can continue later from the dashboard.',
    );
  };

  const continueToPayment = () => {
    if (!progress.docsDone) {
      setError(
        `Upload all required certificates before continuing (${progress.certificatesUploaded} of ${progress.certificatesRequired}). The payment receipt is uploaded on the next step.`,
      );
      return;
    }
    router.push('/school-admissions-portal/payment');
  };

  return (
    <SchoolApplicantNav
      sidebar={
        <>
          <aside className="tps-doc-side-card is-instructions">
            <p className="flex items-center gap-2 font-semibold text-[#1a5336]">
              <Info className="h-4 w-4" />
              Important Instructions
            </p>
            <ol className="mt-3 list-decimal space-y-1.5 pl-4 text-sm leading-relaxed text-slate-700">
              <li>Upload clear, readable photos of original documents.</li>
              <li>{SCHOOL_UPLOAD_FORMAT_HELP}.</li>
              <li>
                Multi-page certificates: upload one JPG/PNG image per page (up to{' '}
                {SCHOOL_UPLOAD_MAX_PAGES_PER_SLOT} pages).
              </li>
              <li>Names must match the child’s birth certificate exactly.</li>
              <li>
                Caste Certificate appears for General / UR so the school can verify the category.
              </li>
              <li>Mother’s ST Certificate appears only for ST + Garo / Khasi / Jaintia.</li>
              <li>Father’s SC or OBC Certificate appears only for SC or OBC categories.</li>
              <li>You can preview, replace, or remove a file before submitting.</li>
              <li>Payment receipt is uploaded on the Fee &amp; Receipt step.</li>
            </ol>
          </aside>

          <aside className="tps-doc-side-card is-progress">
            <p className="font-semibold text-[#1a5336]">Document Upload Progress</p>
            <div className="mt-3 flex items-end justify-between gap-3">
              <p className="text-sm text-slate-600">
                {progress.certificatesUploaded} of {progress.certificatesRequired} required
                documents uploaded
              </p>
              <p className="tps-serif text-3xl leading-none text-[#1a5336]">{pct}%</p>
            </div>
            <div className="tps-doc-progress-track mt-3">
              <div className="tps-doc-progress-fill" style={{ width: `${pct}%` }} />
            </div>
          </aside>

          <aside className="tps-doc-side-card is-checklist">
            <p className="font-semibold text-amber-950">Before Proceeding</p>
            <ul className="mt-3 space-y-2 text-sm text-amber-950/90">
              {[
                'Documents are clear and fully visible',
                'Each file is JPG, JPEG or PNG under 5 MB',
                'You can save progress and return later',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </aside>

          <aside className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            <p className="font-semibold text-[#1a5336]">Need help?</p>
            <p className="mt-1">Admission office, Tura Public School</p>
            {branding.helpPhone ? <p className="mt-1">{branding.helpPhone}</p> : null}
            <p className="mt-0.5 break-all">{branding.helpEmail}</p>
          </aside>
        </>
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#eaf5ee] text-[#1a5336]">
            <FileStack className="h-5 w-5" />
          </span>
          <div>
            <h2 className="tps-serif text-2xl text-[#1a5336]">Documents &amp; Certificates</h2>
            <p className="mt-1 text-sm text-slate-500">{SCHOOL_UPLOAD_FORMAT_HELP}.</p>
          </div>
        </div>
        {me.data?.application.applicationNumber ? (
          <span className="rounded-full bg-[#eaf5ee] px-3 py-1 font-mono text-sm text-[#1a5336]">
            Application No. {me.data.application.applicationNumber}
          </span>
        ) : null}
      </div>

      <div className="mt-5">
        <SchoolWorkflowStepper
          steps={[
            { label: 'Application Form', done: progress.formDone },
            {
              label: 'Documents',
              done: progress.docsDone,
              current: !progress.docsDone,
            },
            {
              label: 'Fee & Receipt',
              done: progress.paymentDone,
              current: progress.docsDone && !progress.paymentDone,
            },
            {
              label: 'Review & Submit',
              done: progress.submitted,
              current: progress.docsDone && progress.paymentDone && !progress.submitted,
            },
          ]}
        />
      </div>

      {category ? (
        <p className="mt-4 rounded-xl bg-[#eaf5ee] px-3 py-2 text-sm text-[#1a5336]">
          Selected Caste / Category: <strong>{category.label}</strong>
          {community ? (
            <>
              {' '}
              · Community / Tribe: <strong>{community}</strong>
            </>
          ) : null}
          . Certificate uploads below appear only when required for this selection.
        </p>
      ) : (
        <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Select Caste / Category (and Community / Tribe when asked) on the application form so the
          correct certificates can be shown here.
        </p>
      )}

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="mt-3 text-sm text-emerald-700">{notice}</p> : null}

      <div className="mt-5 space-y-3">
        {certificateSlots.map((slot) => {
          const uploaded = docs.find((d) => d.slotCode === slot.code);
          const extraPages = pagesForBase(slot.code);
          return (
            <SchoolDocumentUploadRow
              key={slot.code}
              slot={{
                code: slot.code,
                label: slot.label,
                required: slot.required,
                optional: slot.optional,
                hint: slot.hint,
                description: schoolDocSlotDescription(slot.code, slot.hint),
              }}
              uploaded={uploaded}
              extraPages={extraPages}
              readOnly={readOnly && slot.code !== 'PHOTO'}
              busy={busySlot === slot.code}
              onUpload={(files, mode) => onUpload(slot.code, files, mode)}
              onRemove={readOnly ? undefined : () => onRemove(slot.code)}
              onRemovePage={readOnly ? undefined : (code) => onRemove(code)}
            />
          );
        })}
      </div>

      {!readOnly ? (
        <div className="tps-doc-footer-actions mt-6">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              className="border-[#1a5336] text-[#1a5336] hover:bg-emerald-50"
              onClick={saveDraft}
            >
              <Save className="mr-2 h-4 w-4" />
              Save as Draft
            </Button>
            <p className="text-xs text-slate-500 sm:max-w-[14rem]">
              Your details and uploaded documents will be saved.
            </p>
          </div>
          <Button
            type="button"
            className="bg-[#1a5336] text-white hover:bg-[#15462d]"
            onClick={continueToPayment}
          >
            Save &amp; Continue
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">
          This application is locked after submission. You can still view uploaded files.
        </p>
      )}
    </SchoolApplicantNav>
  );
}
