import { z } from 'zod';
import {
  evaluateSchoolAgeEligibility,
  TPS_KG_2027_CENSUS_DATE,
  TPS_KG_2027_MAX_AGE_YEARS_EXCLUSIVE,
  TPS_KG_2027_MIN_AGE_YEARS,
} from './school-age-eligibility';

export const SCHOOL_DOCUMENT_SLOTS = [
  { code: 'PHOTO', label: 'Passport photograph (school uniform)', required: true },
  { code: 'BIRTH_CERT', label: 'Birth Certificate of the Child', required: true },
  { code: 'CASTE_CERT', label: 'Caste Certificate', required: false },
  { code: 'MOTHER_ST_CERT', label: 'Mother’s ST Certificate', required: false },
  {
    code: 'FATHER_SC_OBC_CERT',
    label: 'Father’s SC / OBC Certificate',
    required: false,
  },
  { code: 'LAST_SCHOOL_REPORT', label: 'Last school report card', required: true },
  { code: 'LAST_SCHOOL_CERT', label: 'Last school certificate', required: true },
  { code: 'FATHER_INCOME', label: 'Father income certificate', required: true },
  { code: 'MOTHER_INCOME', label: 'Mother income certificate', required: true },
  { code: 'PAYMENT_RECEIPT', label: 'Admission fee payment receipt', required: true },
] as const;

export const GENDER_OPTIONS = ['Male', 'Female'] as const;
export const BLOOD_GROUPS = [
  'A+',
  'A-',
  'B+',
  'B-',
  'O+',
  'O-',
  'AB+',
  'AB-',
  'Not checked',
] as const;

/** 28 states and 8 union territories (as of 2020 reorganisation, still current). */
export const INDIAN_STATES_AND_UTS = [
  'Andaman and Nicobar Islands',
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chandigarh',
  'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jammu and Kashmir',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Ladakh',
  'Lakshadweep',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Puducherry',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
] as const;

export function schoolRegisterSchema(options?: {
  censusDate?: string;
  minAgeYears?: number;
  maxAgeYearsExclusive?: number;
}) {
  const censusDate = options?.censusDate ?? TPS_KG_2027_CENSUS_DATE;
  const minAgeYears = options?.minAgeYears ?? TPS_KG_2027_MIN_AGE_YEARS;
  const maxAgeYearsExclusive = options?.maxAgeYearsExclusive ?? TPS_KG_2027_MAX_AGE_YEARS_EXCLUSIVE;

  return z
    .object({
      childFullName: z.string().min(2, 'Enter the child’s full name'),
      dateOfBirth: z.string().min(1, 'Date of birth is required'),
      gender: z.string().min(1),
      email: z.string().email(),
      phone: z.string().min(10, 'Enter a reachable 10-digit mobile number'),
      otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit email OTP'),
      acceptedPolicies: z.boolean().refine((v) => v === true, {
        message:
          'You must confirm the child attended Nursery and that age as on 1st January 2027 is at least 5 years and not more than 6 years',
      }),
    })
    .superRefine((values, ctx) => {
      const age = evaluateSchoolAgeEligibility(
        values.dateOfBirth,
        censusDate,
        minAgeYears,
        maxAgeYearsExclusive,
      );
      if (!age.eligible) {
        ctx.addIssue({
          code: 'custom',
          path: ['dateOfBirth'],
          message: age.message,
        });
      }
    });
}
