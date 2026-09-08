import { resolveSchoolCasteCategory } from './school-admission-category';
import {
  DEFAULT_SCHOOL_DOCUMENT_REQUIREMENTS,
  resolveApplicableSchoolCertificates,
  schoolConditionalSlotLabel,
  type SchoolDocumentRequirementsConfig,
} from './school-document-requirements';
import { evaluateSchoolAgeEligibility } from './school-age-eligibility';
import {
  isValidSchoolPinCode,
  schoolAddressPinCode,
} from './school-address-pin';

export const SCHOOL_CYCLE_PROFILE = 'SCHOOL';

export const SCHOOL_DOCUMENT_SLOTS = [
  {
    code: 'PHOTO',
    label: 'Passport photograph (school uniform)',
    required: true,
  },
  {
    code: 'BIRTH_CERT',
    label: 'Birth Certificate of the Child',
    required: true,
  },
  /** Conditional caste slot — required for General / UR via document rules. */
  { code: 'CASTE_CERT', label: 'Caste Certificate', required: false },
  {
    code: 'MOTHER_ST_CERT',
    label: 'Mother’s ST Certificate',
    required: false,
  },
  {
    code: 'FATHER_SC_OBC_CERT',
    label: 'Father’s SC / OBC Certificate',
    required: false,
  },
  {
    code: 'LAST_SCHOOL_REPORT',
    label: 'Last school report card',
    required: true,
  },
  {
    code: 'LAST_SCHOOL_CERT',
    label: 'Last school certificate',
    required: true,
  },
  { code: 'FATHER_INCOME', label: 'Father income certificate', required: true },
  { code: 'MOTHER_INCOME', label: 'Mother income certificate', required: true },
  {
    code: 'PAYMENT_RECEIPT',
    label: 'Admission fee payment receipt',
    required: true,
  },
] as const;

export type SchoolDocumentSlotCode =
  (typeof SCHOOL_DOCUMENT_SLOTS)[number]['code'];

export const SCHOOL_ALLOWED_SLOT_CODES = SCHOOL_DOCUMENT_SLOTS.map(
  (slot) => slot.code,
);

export type SchoolBankDetails = {
  accountName: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
  branch?: string;
  upiId?: string;
  instructions?: string;
};

export type SchoolCycleSettings = {
  profile: typeof SCHOOL_CYCLE_PROFILE;
  classCode: string;
  sessionLabel: string;
  censusDate: string;
  minAgeYears: number;
  maxAgeYearsExclusive: number;
  requireNursery: boolean;
  paymentMode: 'MANUAL_BANK';
  requirePaymentProofBeforeSubmit: boolean;
  applicationFee: number;
  applicationNumberPrefix?: string;
  bank: SchoolBankDetails;
  helpDesk?: { phone?: string; email?: string };
  /**
   * Master switch for new online admissions (register / OTP).
   * Defaults to true when omitted so existing cycles stay open.
   */
  newAdmissionsEnabled?: boolean;
  /**
   * Maximum number of online applications for this cycle.
   * Defaults to 50 when omitted. Staff can raise or lower it from Admission Settings.
   */
  maxOnlineApplications?: number;
  /**
   * Conditional certificates (Mother’s ST / Father’s SC or OBC, etc.).
   * Editable from the school admissions admin settings panel.
   */
  documentRequirements?: SchoolDocumentRequirementsConfig;
};

export type SchoolAdmissionWindowStatus = 'OPEN' | 'CLOSED';

export type SchoolAdmissionWindowEvaluation = {
  isOpen: boolean;
  status: SchoolAdmissionWindowStatus;
  newAdmissionsEnabled: boolean;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
  /** Why registration is closed (null when open). */
  closedReason:
    | 'disabled'
    | 'not_started'
    | 'ended'
    | 'cycle_unavailable'
    | 'capacity'
    | null;
  message: string;
  lastDateLabel: string | null;
  maxOnlineApplications: number;
  applicationCount: number;
  seatsRemaining: number;
};

export const SCHOOL_DEFAULT_MAX_ONLINE_APPLICATIONS = 50;
export const SCHOOL_MAX_ONLINE_APPLICATIONS_CEILING = 10_000;

export function schoolMaxOnlineApplications(
  settings?: Pick<SchoolCycleSettings, 'maxOnlineApplications'> | null,
): number {
  const raw = settings?.maxOnlineApplications;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.min(
      SCHOOL_MAX_ONLINE_APPLICATIONS_CEILING,
      Math.max(1, Math.floor(raw)),
    );
  }
  return SCHOOL_DEFAULT_MAX_ONLINE_APPLICATIONS;
}

function windowCounts(
  settings?: SchoolCycleSettings | null,
  currentApplicationCount?: number,
) {
  const maxOnlineApplications = schoolMaxOnlineApplications(settings);
  const applicationCount = Math.max(
    0,
    Math.floor(currentApplicationCount ?? 0),
  );
  return {
    maxOnlineApplications,
    applicationCount,
    seatsRemaining: Math.max(0, maxOnlineApplications - applicationCount),
  };
}

/** End of 25 September 2026 in India. `2026-09-25T23:59:59Z` is already 26 Sep IST. */
export const TPS_KG_2027_REGISTRATION_CLOSES_AT = new Date(
  '2026-09-25T18:29:59.000Z',
);

/**
 * `YYYY-MM-DDT23:59:59.000Z` was stored as “that calendar date”. In IST it is
 * already the next morning, so treat it as 23:59:59 on that date in India.
 */
function schoolCloseInstant(d: Date): Date {
  if (
    d.getUTCHours() === 23 &&
    d.getUTCMinutes() === 59 &&
    d.getUTCSeconds() === 59
  ) {
    return new Date(
      Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate(),
        18,
        29,
        59,
        d.getUTCMilliseconds(),
      ),
    );
  }
  return d;
}

function istDayOrdinal(day: number): string {
  const teens = day % 100;
  if (teens >= 11 && teens <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

/** Parent-facing last date, e.g. "25th September, 2026 (Friday)" in IST. */
function formatAdmissionDateIn(d: Date | null | undefined): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).formatToParts(d);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const day = Number(value('day'));
  if (!Number.isFinite(day) || day < 1) return null;
  return `${istDayOrdinal(day)} ${value('month')}, ${value('year')} (${value('weekday')})`;
}

/**
 * Single source of truth for whether new K.G. online registration is allowed.
 * Existing draft/submitted applications are not affected by this check.
 */
export function evaluateSchoolAdmissionWindow(input: {
  cycleStatus?: string | null;
  settings?: SchoolCycleSettings | null;
  registrationOpensAt?: Date | string | null;
  registrationClosesAt?: Date | string | null;
  currentApplicationCount?: number;
  now?: Date;
}): SchoolAdmissionWindowEvaluation {
  const now = input.now ?? new Date();
  const opensAt = input.registrationOpensAt
    ? new Date(input.registrationOpensAt)
    : null;
  const closesAtRaw = input.registrationClosesAt
    ? new Date(input.registrationClosesAt)
    : null;
  const opensValid =
    opensAt && !Number.isNaN(opensAt.getTime()) ? opensAt : null;
  const closesValid =
    closesAtRaw && !Number.isNaN(closesAtRaw.getTime())
      ? schoolCloseInstant(closesAtRaw)
      : null;
  const lastDateLabel = formatAdmissionDateIn(closesValid);
  const enabled = input.settings?.newAdmissionsEnabled !== false;
  const counts = windowCounts(input.settings, input.currentApplicationCount);
  const base = {
    registrationOpensAt: opensValid,
    registrationClosesAt: closesValid,
    lastDateLabel,
    ...counts,
  };

  if (!input.cycleStatus || input.cycleStatus === 'ARCHIVED') {
    return {
      ...base,
      isOpen: false,
      status: 'CLOSED',
      newAdmissionsEnabled: enabled,
      closedReason: 'cycle_unavailable',
      message: 'Online admissions are currently closed.',
    };
  }

  if (!enabled) {
    return {
      ...base,
      isOpen: false,
      status: 'CLOSED',
      newAdmissionsEnabled: false,
      closedReason: 'disabled',
      message: 'Online admissions are currently closed.',
    };
  }

  if (opensValid && opensValid > now) {
    return {
      ...base,
      isOpen: false,
      status: 'CLOSED',
      newAdmissionsEnabled: true,
      closedReason: 'not_started',
      message: `Online admissions open on ${formatAdmissionDateIn(opensValid)}.`,
    };
  }

  if (closesValid && closesValid < now) {
    return {
      ...base,
      isOpen: false,
      status: 'CLOSED',
      newAdmissionsEnabled: true,
      closedReason: 'ended',
      message: lastDateLabel
        ? `Online admissions are currently closed. The last date to apply was ${lastDateLabel}.`
        : 'Online admissions are currently closed.',
    };
  }

  if (counts.seatsRemaining <= 0) {
    return {
      ...base,
      isOpen: false,
      status: 'CLOSED',
      newAdmissionsEnabled: true,
      closedReason: 'capacity',
      message: `Online applications are closed. The school has reached the limit of ${counts.maxOnlineApplications} applications.`,
    };
  }

  return {
    ...base,
    isOpen: true,
    status: 'OPEN',
    newAdmissionsEnabled: true,
    closedReason: null,
    message: closesValid
      ? `Online admissions are open until ${lastDateLabel}.`
      : 'Online admissions are open.',
  };
}

export type { AgeParts } from './school-age-eligibility';
export {
  TPS_KG_2027_CENSUS_DATE,
  TPS_KG_2027_MIN_AGE_YEARS,
  TPS_KG_2027_MAX_AGE_YEARS_EXCLUSIVE,
  SCHOOL_AGE_RULE_LINE,
  SCHOOL_AGE_INELIGIBLE_MESSAGE,
  parseDateOnly,
  formatUtcDateIso,
  formatUtcDateLong,
  compareUtcDateOnly,
  addUtcCalendarDays,
  eligibleDobRangeUtc,
  eligibleDobIsoRange,
  ageAsOf,
  schoolAgeIneligibleMessage,
  evaluateSchoolAgeEligibility,
} from './school-age-eligibility';

export function isSchoolCycleSettings(
  value: unknown,
): value is SchoolCycleSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return (value as { profile?: string }).profile === SCHOOL_CYCLE_PROFILE;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function getSchoolFormGaps(
  formData: Record<string, unknown> | null | undefined,
  settings?: Pick<
    SchoolCycleSettings,
    'censusDate' | 'minAgeYears' | 'maxAgeYearsExclusive' | 'requireNursery'
  > | null,
): string[] {
  const data = formData ?? {};
  const child = asRecord(data.child);
  const permanentAddress = asRecord(data.permanentAddress);
  const presentAddress = asRecord(data.presentAddress);
  const father = asRecord(data.father);
  const mother = asRecord(data.mother);
  const gaps: string[] = [];

  if (!text(child.fullName)) gaps.push('Child’s full name');
  if (!text(child.dateOfBirth)) {
    gaps.push('Date of birth');
  } else if (settings?.censusDate) {
    const age = evaluateSchoolAgeEligibility(
      text(child.dateOfBirth),
      settings.censusDate,
      settings.minAgeYears,
      settings.maxAgeYearsExclusive,
    );
    if (!age.eligible) gaps.push(age.message);
  }
  if (!text(child.gender)) gaps.push('Gender');
  if (!text(child.bloodGroup)) gaps.push('Blood group');
  const category = resolveSchoolCasteCategory(child);
  if (!category) gaps.push('Caste / Category');
  if (category?.requireCommunity && !text(child.community)) {
    gaps.push('Community / Tribe (if applicable)');
  }
  if (!text(child.nationality)) gaps.push('Nationality');
  if (!text(child.lastSchool)) gaps.push('School last attended');
  if ((settings?.requireNursery ?? true) && child.attendedNursery !== true) {
    gaps.push('Nursery attendance confirmation');
  }

  if (!text(permanentAddress.village)) gaps.push('Permanent village');
  if (!text(permanentAddress.po)) gaps.push('Permanent P.O.');
  if (!text(permanentAddress.district)) gaps.push('Permanent district');
  if (!text(permanentAddress.state)) gaps.push('Permanent state');
  if (!isValidSchoolPinCode(schoolAddressPinCode(permanentAddress))) {
    gaps.push('Permanent PIN Code');
  }

  if (!text(presentAddress.po)) gaps.push('Present P.O.');
  if (!text(presentAddress.district)) gaps.push('Present district');
  if (!text(presentAddress.landmark)) gaps.push('Present landmark');
  if (!text(presentAddress.state)) gaps.push('Present state');
  if (!isValidSchoolPinCode(schoolAddressPinCode(presentAddress))) {
    gaps.push('Present PIN Code');
  }

  if (!text(father.fullName)) gaps.push('Father’s full name');
  if (!text(father.occupation)) gaps.push('Father’s occupation');
  if (!text(father.mobile) || text(father.mobile).length < 10) {
    gaps.push('Father’s mobile');
  }
  if (!text(mother.fullName)) gaps.push('Mother’s full name');
  if (!text(mother.occupation)) gaps.push('Mother’s occupation');
  if (!text(mother.mobile) || text(mother.mobile).length < 10) {
    gaps.push('Mother’s mobile');
  }

  return gaps;
}

export function requiredSchoolDocumentCodes(
  formData?: Record<string, unknown> | null,
  includePaymentReceipt = true,
  documentRequirements?: unknown,
): SchoolDocumentSlotCode[] {
  const child = asRecord(formData?.child);
  const category = resolveSchoolCasteCategory(child);
  const conditional = resolveApplicableSchoolCertificates(formData, {
    categoryCode: category?.code ?? null,
    documentRequirements:
      documentRequirements ?? DEFAULT_SCHOOL_DOCUMENT_REQUIREMENTS,
  });
  const conditionalRequired = new Set(
    conditional.filter((item) => item.required).map((item) => item.slotCode),
  );

  const base = SCHOOL_DOCUMENT_SLOTS.filter((slot) => {
    if (!includePaymentReceipt && slot.code === 'PAYMENT_RECEIPT') return false;
    if (
      slot.code === 'CASTE_CERT' ||
      slot.code === 'MOTHER_ST_CERT' ||
      slot.code === 'FATHER_SC_OBC_CERT'
    ) {
      return conditionalRequired.has(slot.code);
    }
    return slot.required;
  }).map((slot) => slot.code);

  return base;
}

export function formatSchoolDocumentLabels(
  codes: string[],
  formData?: Record<string, unknown> | null,
  documentRequirements?: unknown,
): string {
  const child = asRecord(formData?.child);
  const category = resolveSchoolCasteCategory(child);
  const conditional = resolveApplicableSchoolCertificates(formData, {
    categoryCode: category?.code ?? null,
    documentRequirements:
      documentRequirements ?? DEFAULT_SCHOOL_DOCUMENT_REQUIREMENTS,
  });
  const labels = new Map<string, string>(
    SCHOOL_DOCUMENT_SLOTS.map((slot) => [slot.code, slot.label]),
  );
  for (const item of conditional) {
    labels.set(item.slotCode, item.label);
  }
  for (const code of [
    'CASTE_CERT',
    'MOTHER_ST_CERT',
    'FATHER_SC_OBC_CERT',
  ] as const) {
    const fromConfig = schoolConditionalSlotLabel(code, documentRequirements);
    if (fromConfig) labels.set(code, fromConfig);
  }
  return codes.map((code) => labels.get(code) ?? code).join(', ');
}

export function defaultTpsKg2027Settings(): SchoolCycleSettings {
  return {
    profile: SCHOOL_CYCLE_PROFILE,
    classCode: 'KG',
    sessionLabel: 'Academic Session 2027',
    censusDate: '2027-01-01',
    minAgeYears: 5,
    maxAgeYearsExclusive: 6,
    requireNursery: true,
    paymentMode: 'MANUAL_BANK',
    requirePaymentProofBeforeSubmit: true,
    applicationFee: 100,
    applicationNumberPrefix: 'TPS27',
    bank: {
      accountName: 'Tura Public School',
      accountNumber: '10949575002',
      ifsc: 'SBIN0000198',
      bankName: 'State Bank of India',
      branch: 'SBI Main Branch Tura',
      instructions:
        'Transfer the ₹100 application fee to the school account and upload the receipt. Use your application number as the payment reference.',
    },
    helpDesk: {
      phone: '',
      email: 'info@turapublicschool.com',
    },
    newAdmissionsEnabled: true,
    maxOnlineApplications: 50,
    documentRequirements: structuredClone(DEFAULT_SCHOOL_DOCUMENT_REQUIREMENTS),
  };
}
