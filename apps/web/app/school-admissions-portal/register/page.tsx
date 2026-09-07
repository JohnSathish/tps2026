'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, BookOpen, Send, UserPlus } from 'lucide-react';
import { SchoolPublicSplit } from '@/components/school-admissions-portal/school-public-split';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GENDER_OPTIONS, schoolRegisterSchema } from '@/lib/school-admissions-schema';
import { eligibleDobIsoRange } from '@/lib/school-age-eligibility';
import {
  isSchoolExistingApplicationError,
  isSchoolExistingEmailApplicationError,
} from '@/lib/school-existing-application-error';
import { apiErrorMessage } from '@/utils/api-error';
import {
  fetchSchoolPortalInfo,
  registerSchoolApplicant,
  requestSchoolEmailOtp,
} from '@/services/school-admissions';

type FormValues = z.infer<ReturnType<typeof schoolRegisterSchema>>;

const CREDENTIALS_KEY = 'tps-kg-registration';
const LOGIN_HREF = '/school-admissions-portal/login';
const PARENT_GUIDE_HREF = '/school-admissions/kg-admission-2027-instructions.html';

export default function SchoolAdmissionsRegisterPage() {
  const router = useRouter();
  const info = useQuery({ queryKey: ['school-admissions-info'], queryFn: fetchSchoolPortalInfo });
  const schema = useMemo(
    () =>
      schoolRegisterSchema({
        censusDate: info.data?.settings?.censusDate,
        minAgeYears: info.data?.settings?.minAgeYears,
        maxAgeYearsExclusive: info.data?.settings?.maxAgeYearsExclusive,
      }),
    [
      info.data?.settings?.censusDate,
      info.data?.settings?.minAgeYears,
      info.data?.settings?.maxAgeYearsExclusive,
    ],
  );
  const dobWindow = eligibleDobIsoRange(
    info.data?.settings?.censusDate,
    info.data?.settings?.minAgeYears,
    info.data?.settings?.maxAgeYearsExclusive,
  );
  const [result, setResult] = useState<{
    username: string;
    password?: string;
    email: string;
    emailSent?: boolean;
    ageWarning?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [existingApplication, setExistingApplication] = useState<null | 'email' | 'phone'>(null);
  const [otpMessage, setOtpMessage] = useState<string | null>(null);
  const [otpSending, setOtpSending] = useState(false);
  const {
    register,
    handleSubmit,
    getValues,
    trigger,
    watch,
    formState: { isSubmitting, errors },
  } = useForm<FormValues>({
    resolver: (values, context, options) => zodResolver(schema)(values, context, options),
    defaultValues: { acceptedPolicies: false },
  });

  const emailValue = watch('email');
  const phoneValue = watch('phone');

  useEffect(() => {
    if (!result) return;
    const timer = window.setTimeout(() => {
      router.replace('/school-admissions-portal/login?registered=1');
    }, 12000);
    return () => window.clearTimeout(timer);
  }, [result, router]);

  useEffect(() => {
    if (existingApplication === 'email') {
      setExistingApplication(null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clear alert when email is edited
  }, [emailValue]);

  useEffect(() => {
    if (existingApplication === 'phone') {
      setExistingApplication(null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clear alert when phone is edited
  }, [phoneValue]);

  const sendOtp = async () => {
    setError(null);
    setExistingApplication(null);
    const emailOk = await trigger(['email', 'childFullName']);
    if (!emailOk) return;
    setOtpSending(true);
    try {
      const values = getValues();
      const data = await requestSchoolEmailOtp({
        email: values.email,
        childFullName: values.childFullName,
      });
      setOtpMessage(data.message);
    } catch (err) {
      if (isSchoolExistingEmailApplicationError(err)) {
        setExistingApplication('email');
        setError(null);
      } else if (isSchoolExistingApplicationError(err)) {
        setExistingApplication('phone');
        setError(null);
      } else {
        setError(apiErrorMessage(err));
      }
    } finally {
      setOtpSending(false);
    }
  };

  const onSubmit = async (values: FormValues) => {
    if (existingApplication) return;
    setError(null);
    setExistingApplication(null);
    try {
      const data = await registerSchoolApplicant({
        childFullName: values.childFullName,
        dateOfBirth: values.dateOfBirth,
        gender: values.gender,
        email: values.email,
        phone: values.phone,
        acceptedPolicies: values.acceptedPolicies,
        otp: values.otp,
      });
      const password = data.password ?? data.generatedPassword;
      const payload = {
        username: data.username ?? data.applicationNumber,
        password,
        email: data.email,
        emailSent: data.emailSent,
        ageWarning: data.ageWarning,
      };
      setResult(payload);
      sessionStorage.setItem(CREDENTIALS_KEY, JSON.stringify(payload));
    } catch (err) {
      if (isSchoolExistingEmailApplicationError(err)) {
        setExistingApplication('email');
        setError(null);
      } else if (isSchoolExistingApplicationError(err)) {
        setExistingApplication('phone');
        setError(null);
      } else {
        setError(apiErrorMessage(err));
      }
    }
  };

  const step = result ? 3 : otpMessage ? 2 : 1;
  const createDisabled =
    isSubmitting || info.data?.isOpen === false || Boolean(existingApplication);

  return (
    <SchoolPublicSplit>
      <div className="tps-public-card relative p-6 sm:p-8">
        {result ? (
          <div className="space-y-3">
            <h2 className="tps-serif text-2xl">Registration complete</h2>
            <p className="text-sm text-slate-500">
              Save these details. You will be taken to the login page in a few seconds.
            </p>
            <div className="rounded-xl bg-[#eaf5ee] p-4 text-sm">
              <p>
                Username / application number:{' '}
                <strong className="font-mono">{result.username}</strong>
              </p>
              {result.password ? (
                <p className="mt-1">
                  6-digit PIN:{' '}
                  <strong className="font-mono tracking-widest">{result.password}</strong>
                </p>
              ) : null}
              <p className="mt-1">Email: {result.email}</p>
            </div>
            {result.emailSent ? (
              <p className="text-sm text-emerald-800">
                The same login details have been emailed to {result.email}.
              </p>
            ) : (
              <p className="text-sm text-amber-700">
                We could not send the email just now. Please copy the username and 6-digit PIN
                above.
              </p>
            )}
            {result.ageWarning ? (
              <p className="text-sm text-amber-700">{result.ageWarning}</p>
            ) : null}
            <Button asChild className="h-12 w-full bg-[#1a5336] text-white hover:bg-[#15462d]">
              <Link href="/school-admissions-portal/login?registered=1">Continue to login</Link>
            </Button>
          </div>
        ) : info.data && info.data.isOpen === false ? (
          <div className="space-y-4">
            <p className="inline-flex rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-rose-800">
              Admissions closed
            </p>
            <h2 className="tps-serif text-2xl text-slate-900">
              {info.data.closedReason === 'capacity'
                ? 'Application limit reached'
                : 'Online admissions are currently closed'}
            </h2>
            <p className="text-sm text-slate-600">
              {info.data.message || 'Online admissions are currently closed.'}
            </p>
            <a
              href={PARENT_GUIDE_HREF}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm font-semibold text-[#1a5336] underline"
            >
              <BookOpen className="h-4 w-4" aria-hidden />
              Parent User Guide
            </a>
            {info.data.lastDateLabel ? (
              <p className="text-sm text-slate-600">
                The last date to apply was {info.data.lastDateLabel}.
              </p>
            ) : null}
            <Button asChild variant="outline" className="h-12 w-full">
              <Link href={LOGIN_HREF}>Already registered? Login</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <div>
              <p className="inline-flex rounded-full bg-[#eaf5ee] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#1a5336]">
                New applicant
              </p>
              <h2 className="tps-serif mt-2 text-2xl text-slate-900">
                Register for K.G. Admission 2027
              </h2>
              <a
                href={PARENT_GUIDE_HREF}
                target="_blank"
                rel="noreferrer"
                className="mt-3 flex items-start gap-3 rounded-xl border border-[#c6e2d1] bg-[#eaf5ee] px-3.5 py-3 text-sm text-[#1a5336] transition hover:bg-[#dff0e5]"
              >
                <BookOpen className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  <span className="font-semibold">Parent User Guide</span>
                  <span className="mt-0.5 block text-xs font-normal leading-relaxed text-slate-600">
                    Read the step-by-step instructions before you register (print or save as PDF).
                  </span>
                </span>
              </a>
            </div>
            <ol className="grid grid-cols-3 gap-2 rounded-2xl bg-[#f4f7f5] p-3 text-center text-[11px] font-medium">
              {['Basic Details', 'Verify Email', 'Get Login Details'].map((label, index) => {
                const n = index + 1;
                const active = step >= n;
                return (
                  <li key={label} className="flex flex-col items-center gap-1.5">
                    <span
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-sm ${
                        active
                          ? 'bg-[#1a5336] text-white shadow-sm'
                          : 'bg-white text-slate-400 ring-1 ring-slate-200'
                      }`}
                    >
                      {n}
                    </span>
                    <span className={active ? 'text-[#1a5336]' : 'text-slate-400'}>{label}</span>
                  </li>
                );
              })}
            </ol>
            <div>
              <Label htmlFor="childFullName">Child’s full name (block letters)</Label>
              <Input
                id="childFullName"
                className="tps-public-input mt-1 h-11 uppercase"
                placeholder="Enter child's full name (BLOCK LETTERS)"
                autoComplete="name"
                {...register('childFullName')}
              />
              {errors.childFullName ? (
                <p className="text-xs text-destructive">{errors.childFullName.message}</p>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="dateOfBirth">Date of birth</Label>
                <Input
                  id="dateOfBirth"
                  type="date"
                  className="tps-public-input mt-1 h-11"
                  min={dobWindow?.minDob}
                  max={dobWindow?.maxDob}
                  autoComplete="bday"
                  {...register('dateOfBirth')}
                />
                {errors.dateOfBirth ? (
                  <p className="text-xs text-destructive">{errors.dateOfBirth.message}</p>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">
                    Age as on 1st January 2027:{' '}
                    <strong>At least 5 years and not more than 6 years.</strong>
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="gender">Gender</Label>
                <select
                  id="gender"
                  className="tps-public-input mt-1 h-11 w-full rounded-md border border-input px-3"
                  {...register('gender')}
                >
                  <option value="">Select Gender</option>
                  {GENDER_OPTIONS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <Label htmlFor="phone">Parent / guardian mobile number</Label>
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                className="tps-public-input mt-1 h-11"
                {...register('phone')}
              />
            </div>
            <div>
              <Label htmlFor="email">Parent / guardian email address</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                className="tps-public-input mt-1 h-11"
                {...register('email')}
              />
            </div>
            <div>
              <Label htmlFor="otp">Email OTP</Label>
              <div className="mt-1 flex gap-2">
                <Input
                  id="otp"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="one-time-code"
                  className="h-11"
                  {...register('otp')}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 shrink-0 border-[#1a5336] text-[#1a5336]"
                  onClick={() => void sendOtp()}
                  disabled={otpSending || existingApplication === 'email'}
                >
                  <Send className="mr-1 h-4 w-4" />
                  {otpSending ? 'Sending…' : 'Send OTP'}
                </Button>
              </div>
              {otpMessage ? <p className="text-xs text-emerald-700">{otpMessage}</p> : null}
              {errors.otp ? <p className="text-xs text-destructive">{errors.otp.message}</p> : null}
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" {...register('acceptedPolicies')} />
              <span>
                I confirm the child has attended Nursery and that age as on 1st January 2027 is at
                least 5 years and not more than 6 years.
              </span>
            </label>
            {errors.acceptedPolicies ? (
              <p className="text-xs text-destructive">{errors.acceptedPolicies.message}</p>
            ) : null}

            {existingApplication ? (
              <div
                role="alert"
                aria-live="assertive"
                className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3.5 text-rose-950 shadow-sm"
              >
                <div className="flex gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700">
                    <AlertTriangle className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="text-base font-semibold text-rose-800">
                      Application Already Exists
                    </p>
                    <p className="text-sm leading-relaxed text-rose-900/90">
                      {existingApplication === 'email'
                        ? 'An application is already registered with this email address. Please use your existing login to continue.'
                        : 'An application is already registered with this mobile number. Please use your existing login to continue.'}
                    </p>
                    <Button
                      asChild
                      className="mt-1 h-10 w-full bg-rose-700 text-white hover:bg-rose-800 sm:w-auto"
                    >
                      <Link href={LOGIN_HREF}>Login to Existing Application</Link>
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {error && !existingApplication ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}

            <Button
              type="submit"
              className="h-12 w-full bg-[#1a5336] text-white hover:bg-[#15462d] disabled:opacity-60"
              disabled={createDisabled}
            >
              <UserPlus className="mr-2 h-4 w-4" />
              {isSubmitting ? 'Registering…' : 'Create Application'}
            </Button>
            <p className="text-center text-sm">
              Already registered?{' '}
              <Link className="font-semibold text-[#1a5336] underline" href={LOGIN_HREF}>
                Login here
              </Link>
            </p>
          </form>
        )}
      </div>
    </SchoolPublicSplit>
  );
}
