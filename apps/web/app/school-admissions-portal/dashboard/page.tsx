'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Download, FileText, Receipt, Send } from 'lucide-react';
import { SchoolApplicantNav } from '@/components/school-admissions-portal/school-applicant-nav';
import {
  SchoolEligibilityCard,
  SchoolNeedHelpCard,
  SchoolQuoteCard,
  useSchoolPortalBranding,
} from '@/components/school-admissions-portal/school-admissions-shell';
import { Button } from '@/components/ui/button';
import { useAuthQueryEnabled } from '@/hooks/use-auth';
import { resolveSchoolCasteCategory } from '@/lib/school-admission-category';
import { schoolApplicationProgress } from '@/lib/school-application-progress';
import { apiErrorMessage } from '@/utils/api-error';
import { downloadSchoolApplicationPdf, fetchSchoolApplicantMe } from '@/services/school-admissions';
import { useState } from 'react';

export default function SchoolAdmissionsDashboardPage() {
  const enabled = useAuthQueryEnabled();
  const branding = useSchoolPortalBranding();
  const me = useQuery({
    queryKey: ['school-applicant-me'],
    queryFn: fetchSchoolApplicantMe,
    enabled,
  });
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const app = me.data?.application;
  const fee = me.data?.settings?.applicationFee ?? 0;
  const progress = schoolApplicationProgress(me.data);
  const child = (app?.formData?.child ?? {}) as Record<string, unknown>;
  const category = resolveSchoolCasteCategory(child);
  const { formDone, docsDone, paymentDone, submitted } = progress;
  const steps = [
    { label: 'Application Form', done: formDone, current: !formDone },
    { label: 'Upload Documents', done: docsDone, current: formDone && !docsDone },
    { label: 'Fee Payment', done: paymentDone, current: formDone && docsDone && !paymentDone },
    {
      label: 'Review & Submit',
      done: submitted,
      current: formDone && docsDone && paymentDone && !submitted,
    },
    { label: 'Completed', done: submitted, current: false },
  ];

  const onDownloadPdf = async () => {
    setPdfError(null);
    setDownloading(true);
    try {
      const blob = await downloadSchoolApplicationPdf();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${app?.applicationNumber || 'application'}_KG_2027_Application.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setPdfError(apiErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <SchoolApplicantNav
      framed={false}
      sidebar={
        <>
          <SchoolEligibilityCard />
          <SchoolNeedHelpCard phone={branding.helpPhone} email={branding.helpEmail} />
          <SchoolQuoteCard by="Nelson Mandela">
            Education is the most powerful weapon which you can use to change the world.
          </SchoolQuoteCard>
        </>
      }
    >
      <div className="rounded-2xl bg-[#eaf5ee] p-4 sm:flex sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#1a5336]">
            Welcome
          </p>
          <h2 className="tps-serif mt-1 text-2xl text-[#1a5336]">
            {app?.firstName ? `${app.firstName}` : 'K.G. 2027 application'}
          </h2>
          {app ? (
            <p className="mt-1 font-mono text-sm text-slate-600">{app.applicationNumber}</p>
          ) : null}
          {category ? (
            <p className="mt-1 text-sm text-slate-600">
              Caste / Category: {category.label}
              {typeof child.community === 'string' && child.community.trim()
                ? ` · ${child.community.trim()}`
                : ''}
            </p>
          ) : null}
        </div>
        {app ? (
          <span className="mt-3 inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase text-amber-800 sm:mt-0">
            {app.status.replaceAll('_', ' ')}
          </span>
        ) : null}
      </div>

      <ol className="mt-6 grid grid-cols-2 gap-3 text-center text-[11px] sm:grid-cols-5">
        {steps.map((item, index) => (
          <li key={item.label} className="flex flex-col items-center gap-1">
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                item.done
                  ? 'bg-[#1a5336] text-white'
                  : item.current
                    ? 'bg-[#2e7a52] text-white'
                    : 'bg-slate-200 text-slate-500'
              }`}
            >
              {index + 1}
            </span>
            <span className="text-slate-600">{item.label}</span>
            <span className="text-[10px] uppercase text-slate-400">
              {item.done ? 'Done' : item.current ? 'In progress' : 'Pending'}
            </span>
          </li>
        ))}
      </ol>

      {me.data?.age && !me.data.age.eligible ? (
        <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          {me.data.age.message}
        </p>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <DashCard
          icon={FileText}
          tone="green"
          title="Application Form"
          body="Child, address, father, mother, and sibling details."
          href="/school-admissions-portal/application"
          status={formDone ? 'Done' : 'In Progress'}
          action={formDone ? 'Open' : 'Continue'}
        />
        <DashCard
          icon={ClipboardList}
          tone="blue"
          title="Upload Documents"
          body="Photo, birth certificate of the child, last school papers, father’s and mother’s income certificates, and — when the child’s Caste / Category (and Community) require it — Caste Certificate (General / UR), Mother’s ST, or Father’s SC / OBC certificate."
          href="/school-admissions-portal/documents"
          status={docsDone ? 'Done' : 'Pending'}
        />
        <DashCard
          icon={Receipt}
          tone="red"
          title="Fee & Receipt"
          body={
            fee > 0
              ? `Admission fee ₹${fee}. Transfer to the school account and upload the receipt.`
              : 'Transfer the school fee and upload the receipt.'
          }
          href="/school-admissions-portal/payment"
          status={paymentDone ? 'Done' : 'Pending'}
        />
        <DashCard
          icon={Send}
          tone="purple"
          title="Review & Submit"
          body="Submit opens after the form, documents, and payment receipt are complete."
          href="/school-admissions-portal/review"
          status={submitted ? 'Done' : 'Pending'}
        />
      </div>

      {submitted ? (
        <div className="mt-5 rounded-2xl border border-emerald-200 bg-white p-4 sm:flex sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-[#1a5336]">Application submitted</p>
            <p className="mt-1 text-sm text-slate-600">
              Submitted {app?.submittedAt ? new Date(app.submittedAt).toLocaleString('en-IN') : '—'}
              {me.data?.submission?.email?.status === 'SENT'
                ? ' · PDF emailed to your registered address'
                : me.data?.submission?.email?.status === 'FAILED'
                  ? ' · Email copy could not be sent — download below'
                  : ''}
            </p>
            {pdfError ? <p className="mt-1 text-sm text-destructive">{pdfError}</p> : null}
          </div>
          <Button
            type="button"
            className="mt-3 bg-[#1a5336] text-white hover:bg-[#15462d] sm:mt-0"
            disabled={downloading}
            onClick={() => void onDownloadPdf()}
          >
            <Download className="mr-2 h-4 w-4" />
            {downloading ? 'Preparing…' : 'Download Application PDF'}
          </Button>
        </div>
      ) : app?.status === 'draft' ? (
        <p className="mt-5 rounded-xl bg-[#eaf5ee] p-3 text-sm text-[#1a5336]">
          Submit opens after the form, certificates, and payment receipt are complete.
        </p>
      ) : (
        <p className="mt-5 text-sm text-slate-600">
          Continue your application from the steps above.
        </p>
      )}

      {me.data?.officeDecision ? (
        <p className="mt-5 rounded-xl bg-[#eaf5ee] p-3 text-sm text-[#1a5336]">
          {me.data.officeDecision === 'GRANTED'
            ? `Admission granted${me.data.indexNumber ? ` · Index ${me.data.indexNumber}` : ''}.`
            : me.data.officeDecision === 'NOT_GRANTED'
              ? 'Admission was not granted.'
              : 'Your application is with the school office.'}
        </p>
      ) : null}
    </SchoolApplicantNav>
  );
}

function DashCard({
  title,
  body,
  href,
  status,
  action = 'Open',
  icon: Icon,
  tone,
}: {
  title: string;
  body: string;
  href: string;
  status: string;
  action?: string;
  icon: typeof FileText;
  tone: 'green' | 'blue' | 'red' | 'purple';
}) {
  const tones = {
    green: 'bg-emerald-50 text-[#1a5336]',
    blue: 'bg-sky-50 text-sky-700',
    red: 'bg-rose-50 text-rose-700',
    purple: 'bg-violet-50 text-violet-700',
  };
  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}>
          <Icon className="h-5 w-5" />
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
          {status}
        </span>
      </div>
      <h3 className="mt-3 font-semibold text-[#1a5336]">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">{body}</p>
      <Button asChild size="sm" className="mt-3 bg-[#1a5336] text-white hover:bg-[#15462d]">
        <Link href={href}>{action}</Link>
      </Button>
    </div>
  );
}
