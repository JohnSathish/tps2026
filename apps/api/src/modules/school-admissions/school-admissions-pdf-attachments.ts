import { existsSync, readFileSync } from 'fs';
import { extname, join, resolve, sep } from 'path';
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import sharp from 'sharp';
import { resolveUploadRoot } from '../../common/uploads/upload-paths';
import { schoolDocumentDisplayStatus } from './school-document-display-status';
import { parseSchoolDocumentSlotCode } from './school-upload-image';

export type SchoolPdfAttachmentDoc = {
  slotCode: string;
  label: string;
  fileUrl: string;
  mimeType?: string | null;
  verificationStatus?: string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
};

export type SchoolPdfAttachmentMeta = {
  applicationNumber: string;
  applicantName: string;
  amountLabel?: string | null;
  paymentReference?: string | null;
};

/** Compact attachment unit ready for A4 packing (no cover pages). */
export type PreparedAttachment = {
  slotCode: string;
  label: string;
  attachmentNo: number;
  statusLabel: string;
  extraLines: Array<[string, string]>;
  /** Image content (preferred). */
  image?: {
    bytes: Buffer;
    kind: 'jpeg' | 'png';
    width: number;
    height: number;
  };
  /** Legacy uploaded PDF pages (each placed whole; never split mid-page). */
  pdfPages?: Uint8Array;
  pageCount: number;
};

/** Photo is shown on the form — never repeat in attachments. */
const BASE_ATTACHMENT_ORDER = [
  'BIRTH_CERT',
  'LAST_SCHOOL_REPORT',
  'LAST_SCHOOL_CERT',
  'FATHER_INCOME',
  'MOTHER_INCOME',
] as const;

const CASTE_ATTACHMENT_ORDER = [
  'CASTE_CERT',
  'MOTHER_ST_CERT',
  'FATHER_SC_OBC_CERT',
] as const;

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 36;
const FOOTER_RESERVED = 32;
const SECTION_GAP = 10;
const MIN_IMAGE_BLOCK = 130;
const CONTENT_BOTTOM = MARGIN + FOOTER_RESERVED;
/** Leave room for the compact repeating header stamped on pages 2+. */
const CONTENT_TOP = A4_HEIGHT - MARGIN - 34;
const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2;

/** Helvetica/WinAnsi cannot encode ₹ and many Unicode chars. */
function toWinAnsiSafe(value: string): string {
  return value
    .replace(/₹/g, 'Rs.')
    .replace(/\u2014/g, '-')
    .replace(/\u2013/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/[^\x00-\x7F]/g, '?');
}

export function schoolAttachmentHeadingStatus(input: {
  uploaded: boolean;
  verificationStatus?: string | null;
}): string {
  const display = schoolDocumentDisplayStatus(input);
  if (display.verificationStatus === 'VERIFIED') return 'VERIFIED';
  return display.displayLabel;
}

/** Prefer short school wording for attachment headings. */
export function schoolAttachmentLabelForSlot(
  slotCode: string,
  fallbackLabel: string,
): string {
  switch (slotCode) {
    case 'PHOTO':
      return 'Passport Photograph';
    case 'BIRTH_CERT':
      return 'Birth Certificate of the Child';
    case 'LAST_SCHOOL_REPORT':
      return 'Last School Report Card';
    case 'LAST_SCHOOL_CERT':
      return 'Last School Certificate';
    case 'FATHER_INCOME':
      return "Father's Income Certificate";
    case 'MOTHER_INCOME':
      return "Mother's Income Certificate";
    case 'CASTE_CERT':
      return 'Caste Certificate';
    case 'MOTHER_ST_CERT':
      return "Mother's ST Certificate";
    case 'FATHER_SC_OBC_CERT':
      return "Father's SC / OBC Certificate";
    case 'PAYMENT_RECEIPT':
      return 'Admission Fee Payment Receipt';
    default:
      return fallbackLabel || slotCode;
  }
}

function baseSlotCode(slotCode: string): string {
  return parseSchoolDocumentSlotCode(slotCode)?.baseCode ?? slotCode;
}

/** Ordered uploaded docs only — never invents missing slots. Skips PHOTO. Extra pages follow. */
export function orderSchoolPdfAttachments(input: {
  uploadedDocs: SchoolPdfAttachmentDoc[];
  applicableCasteSlotCodes: string[];
}): SchoolPdfAttachmentDoc[] {
  const byCode = new Map(input.uploadedDocs.map((d) => [d.slotCode, d]));
  const out: SchoolPdfAttachmentDoc[] = [];
  const used = new Set<string>();

  const pushBaseAndPages = (baseCode: string) => {
    if (baseCode === 'PHOTO') return;
    const page1 = byCode.get(baseCode);
    if (page1) {
      out.push(page1);
      used.add(baseCode);
    }
    const extras = input.uploadedDocs
      .map((d) => ({ doc: d, parsed: parseSchoolDocumentSlotCode(d.slotCode) }))
      .filter(
        (x) =>
          x.parsed &&
          x.parsed.baseCode === baseCode &&
          x.parsed.page > 1 &&
          !used.has(x.doc.slotCode),
      )
      .sort((a, b) => a.parsed!.page - b.parsed!.page);
    for (const item of extras) {
      out.push({
        ...item.doc,
        label:
          item.parsed!.page > 1
            ? `${item.doc.label} (page ${item.parsed!.page})`
            : item.doc.label,
      });
      used.add(item.doc.slotCode);
    }
  };

  for (const code of BASE_ATTACHMENT_ORDER) pushBaseAndPages(code);

  const castePreferred = input.applicableCasteSlotCodes.filter((c) =>
    (CASTE_ATTACHMENT_ORDER as readonly string[]).includes(c),
  );
  for (const code of castePreferred) pushBaseAndPages(code);
  for (const code of CASTE_ATTACHMENT_ORDER) {
    if (!castePreferred.includes(code)) pushBaseAndPages(code);
  }

  pushBaseAndPages('PAYMENT_RECEIPT');

  for (const doc of input.uploadedDocs) {
    if (used.has(doc.slotCode)) continue;
    if (baseSlotCode(doc.slotCode) === 'PHOTO') continue;
    out.push(doc);
    used.add(doc.slotCode);
  }
  return out;
}

export function resolveSchoolApplicationFileAbsolute(
  uploadRoot: string,
  tenantId: string,
  applicationId: string,
  publicUrl: string,
): string | null {
  const relative = publicUrl.replace(/^\//, '').replace(/^uploads\//, '');
  const absolute = resolve(join(uploadRoot, relative));
  const expectedPrefix = resolve(
    join(uploadRoot, 'tenants', tenantId, 'school-admissions', applicationId),
  );
  if (
    absolute !== expectedPrefix &&
    !absolute.startsWith(expectedPrefix + sep)
  ) {
    return null;
  }
  if (!existsSync(absolute)) return null;
  return absolute;
}

function isPdfMimeOrPath(
  mimeType: string | null | undefined,
  filePath: string,
): boolean {
  const mime = (mimeType || '').toLowerCase();
  if (mime.includes('pdf')) return true;
  return extname(filePath).toLowerCase() === '.pdf';
}

function isImageMimeOrPath(
  mimeType: string | null | undefined,
  filePath: string,
): boolean {
  const mime = (mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(
    extname(filePath).toLowerCase(),
  );
}

async function optimizeImageForPrint(buffer: Buffer): Promise<{
  bytes: Buffer;
  kind: 'jpeg' | 'png';
  width: number;
  height: number;
}> {
  const meta = await sharp(buffer, { failOn: 'error' }).rotate().metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const maxEdge = Math.max(width, height);

  let pipeline = sharp(buffer, { failOn: 'error' }).rotate();
  if (maxEdge > 2000) {
    pipeline = pipeline.resize({
      width: 1800,
      height: 2400,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  if (meta.hasAlpha || meta.format === 'png' || meta.format === 'webp') {
    const png = await pipeline.png({ compressionLevel: 8 }).toBuffer();
    if (png.length < 2_800_000) {
      const outMeta = await sharp(png).metadata();
      return {
        bytes: png,
        kind: 'png',
        width: outMeta.width ?? width,
        height: outMeta.height ?? height,
      };
    }
    pipeline = sharp(buffer, { failOn: 'error' }).rotate();
    if (maxEdge > 2000) {
      pipeline = pipeline.resize({
        width: 1800,
        height: 2400,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }
  }
  const jpeg = await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  const outMeta = await sharp(jpeg).metadata();
  return {
    bytes: jpeg,
    kind: 'jpeg',
    width: outMeta.width ?? width,
    height: outMeta.height ?? height,
  };
}

function estimateHeadingHeight(extraLineCount: number): number {
  // Title + applicant + app no + status + optional extras + divider padding
  return 52 + extraLineCount * 12;
}

function scaledImageSize(
  naturalW: number,
  naturalH: number,
  maxW: number,
  maxH: number,
): { w: number; h: number } {
  if (naturalW <= 0 || naturalH <= 0)
    return { w: maxW, h: Math.min(maxH, 200) };
  const scale = Math.min(maxW / naturalW, maxH / naturalH, 1);
  return { w: naturalW * scale, h: naturalH * scale };
}

function drawCompactHeading(
  page: PDFPage,
  fonts: { regular: PDFFont; bold: PDFFont },
  input: {
    attachmentNo: number;
    label: string;
    meta: SchoolPdfAttachmentMeta;
    statusLabel: string;
    extraLines: Array<[string, string]>;
    y: number;
  },
): number {
  const green = rgb(0.1, 0.33, 0.21);
  const muted = rgb(0.35, 0.4, 0.45);
  let y = input.y;

  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4_WIDTH - MARGIN, y },
    thickness: 0.8,
    color: green,
  });
  y -= 14;

  const title = toWinAnsiSafe(
    `ATTACHMENT ${input.attachmentNo} — ${input.label.toUpperCase()}`,
  );
  page.drawText(title, {
    x: MARGIN,
    y,
    size: 10,
    font: fonts.bold,
    color: green,
    maxWidth: CONTENT_WIDTH,
  });
  y -= 13;

  page.drawText(toWinAnsiSafe(`Applicant: ${input.meta.applicantName}`), {
    x: MARGIN,
    y,
    size: 9,
    font: fonts.regular,
    color: muted,
    maxWidth: CONTENT_WIDTH,
  });
  y -= 11;

  page.drawText(
    toWinAnsiSafe(`Application No.: ${input.meta.applicationNumber}`),
    {
      x: MARGIN,
      y,
      size: 9,
      font: fonts.regular,
      color: muted,
    },
  );
  y -= 11;

  page.drawText(toWinAnsiSafe(`Status: ${input.statusLabel}`), {
    x: MARGIN,
    y,
    size: 9,
    font: fonts.bold,
    color: green,
    maxWidth: CONTENT_WIDTH,
  });
  y -= 11;

  for (const [k, v] of input.extraLines) {
    page.drawText(toWinAnsiSafe(`${k}: ${v}`), {
      x: MARGIN,
      y,
      size: 9,
      font: fonts.regular,
      color: muted,
      maxWidth: CONTENT_WIDTH,
    });
    y -= 11;
  }

  y -= 2;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4_WIDTH - MARGIN, y },
    thickness: 0.6,
    color: rgb(0.75, 0.82, 0.78),
  });
  y -= 8;
  return y;
}

async function buildLegacyPdfFragment(sourcePdf: Buffer): Promise<Uint8Array> {
  const src = await PDFDocument.load(sourcePdf, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, src.getPageIndices());
  for (const page of pages) {
    const { width, height } = page.getSize();
    const rotate = page.getRotation().angle;
    const landscape = Math.abs(rotate) % 180 === 90;
    const w = landscape ? height : width;
    const h = landscape ? width : height;
    if (w > A4_WIDTH + 1 || h > A4_HEIGHT + 1) {
      const scale = Math.min(A4_WIDTH / w, A4_HEIGHT / h);
      page.scale(scale, scale);
    }
    out.addPage(page);
  }
  return out.save();
}

export async function prepareSchoolPdfAttachments(input: {
  tenantId: string;
  applicationId: string;
  docs: SchoolPdfAttachmentDoc[];
  applicableCasteSlotCodes: string[];
  meta: SchoolPdfAttachmentMeta;
  logger?: { warn: (message: string) => void };
}): Promise<PreparedAttachment[]> {
  const uploadRoot = resolveUploadRoot();
  const ordered = orderSchoolPdfAttachments({
    uploadedDocs: input.docs,
    applicableCasteSlotCodes: input.applicableCasteSlotCodes,
  });
  const prepared: PreparedAttachment[] = [];

  for (const doc of ordered) {
    if (baseSlotCode(doc.slotCode) === 'PHOTO') continue;

    const absolute = resolveSchoolApplicationFileAbsolute(
      uploadRoot,
      input.tenantId,
      input.applicationId,
      doc.fileUrl,
    );
    if (!absolute) {
      input.logger?.warn(
        `Skipping attachment ${doc.slotCode}: file missing or outside application storage`,
      );
      continue;
    }

    const statusLabel = schoolAttachmentHeadingStatus({
      uploaded: true,
      verificationStatus: doc.verificationStatus,
    });
    const extraLines: Array<[string, string]> = [];
    if (baseSlotCode(doc.slotCode) === 'PAYMENT_RECEIPT') {
      if (input.meta.amountLabel)
        extraLines.push(['Amount', input.meta.amountLabel]);
      if (input.meta.paymentReference) {
        extraLines.push(['Transaction / UTR No.', input.meta.paymentReference]);
      }
    }

    try {
      const raw = readFileSync(absolute);
      if (isImageMimeOrPath(doc.mimeType, absolute)) {
        const optimized = await optimizeImageForPrint(raw);
        prepared.push({
          slotCode: doc.slotCode,
          label: doc.label,
          attachmentNo: prepared.length + 1,
          statusLabel,
          extraLines,
          image: optimized,
          pageCount: 1,
        });
      } else if (isPdfMimeOrPath(doc.mimeType, absolute)) {
        const pdfPages = await buildLegacyPdfFragment(raw);
        const loaded = await PDFDocument.load(pdfPages);
        prepared.push({
          slotCode: doc.slotCode,
          label: doc.label,
          attachmentNo: prepared.length + 1,
          statusLabel,
          extraLines,
          pdfPages,
          pageCount: loaded.getPageCount(),
        });
      } else {
        input.logger?.warn(
          `Skipping unsupported attachment type for ${doc.slotCode}`,
        );
      }
    } catch (err) {
      input.logger?.warn(
        `Failed to prepare attachment ${doc.slotCode}: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
    }
  }

  // Renumber after skips
  prepared.forEach((item, idx) => {
    item.attachmentNo = idx + 1;
  });

  return prepared;
}

async function buildCompactAttachmentsPdf(input: {
  attachments: PreparedAttachment[];
  meta: SchoolPdfAttachmentMeta;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fonts = { regular: font, bold: fontBold };
  const green = rgb(0.1, 0.33, 0.21);

  let page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = CONTENT_TOP;

  const startFreshPage = () => {
    page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
    y = CONTENT_TOP;
  };

  page.drawText('DOCUMENT ATTACHMENTS', {
    x: MARGIN,
    y,
    size: 13,
    font: fontBold,
    color: green,
  });
  y -= 14;
  page.drawText(
    toWinAnsiSafe(
      `${input.meta.applicationNumber} · ${input.meta.applicantName}`,
    ),
    {
      x: MARGIN,
      y,
      size: 9,
      font,
      color: rgb(0.35, 0.4, 0.45),
    },
  );
  y -= 8;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4_WIDTH - MARGIN, y },
    thickness: 1.1,
    color: green,
  });
  y -= 12;

  for (const att of input.attachments) {
    if (att.image) {
      const headingH = estimateHeadingHeight(att.extraLines.length);
      const embedded =
        att.image.kind === 'png'
          ? await doc.embedPng(att.image.bytes)
          : await doc.embedJpg(att.image.bytes);

      const tryPlace = (fromY: number) => {
        const maxH = Math.max(fromY - CONTENT_BOTTOM - headingH, 40);
        const size = scaledImageSize(
          embedded.width,
          embedded.height,
          CONTENT_WIDTH,
          maxH,
        );
        return {
          size,
          fits: headingH + size.h <= fromY - CONTENT_BOTTOM + 0.5,
        };
      };

      let placement = tryPlace(y);
      if (!placement.fits) {
        startFreshPage();
        placement = tryPlace(y);
      }

      y = drawCompactHeading(page, fonts, {
        attachmentNo: att.attachmentNo,
        label: att.label,
        meta: input.meta,
        statusLabel: att.statusLabel,
        extraLines: att.extraLines,
        y,
      });

      // Clamp to remaining space after heading (should already fit).
      const size = scaledImageSize(
        embedded.width,
        embedded.height,
        CONTENT_WIDTH,
        Math.max(y - CONTENT_BOTTOM, 40),
      );
      const x = MARGIN + (CONTENT_WIDTH - size.w) / 2;
      const imgY = y - size.h;
      page.drawImage(embedded, {
        x,
        y: imgY,
        width: size.w,
        height: size.h,
      });
      y = imgY - SECTION_GAP;
      continue;
    }

    if (att.pdfPages) {
      const headingH = estimateHeadingHeight(att.extraLines.length);
      if (y - CONTENT_BOTTOM < headingH + 60) startFreshPage();
      y = drawCompactHeading(page, fonts, {
        attachmentNo: att.attachmentNo,
        label: att.label,
        meta: input.meta,
        statusLabel: att.statusLabel,
        extraLines: att.extraLines,
        y,
      });

      const src = await PDFDocument.load(att.pdfPages);
      const copied = await doc.copyPages(src, src.getPageIndices());
      for (const pdfPage of copied) {
        doc.addPage(pdfPage);
      }
      startFreshPage();
    }
  }

  // Remove a trailing blank page created only as a resume cursor after the last item.
  const allPages = doc.getPages();
  if (allPages.length >= 2) {
    const lastIdx = allPages.length - 1;
    // Heuristic: last page has no content drawn near the top title area if y is still CONTENT_TOP
    // and we just called startFreshPage after the final attachment.
    if (y === CONTENT_TOP) {
      doc.removePage(lastIdx);
    }
  }

  return doc.save();
}

function stampPageNumbers(
  page: PDFPage,
  font: PDFFont,
  pageNo: number,
  total: number,
  applicationNumber: string,
) {
  const green = rgb(0.1, 0.33, 0.21);
  const muted = rgb(0.35, 0.4, 0.45);

  // Compact repeating header on pages after the full institutional masthead (page 1).
  if (pageNo > 1) {
    const line1 = 'Tura Public School, Tura';
    const line2 = 'K.G. Admission - Academic Session 2027';
    const line3 = `Application No.: ${applicationNumber}`;
    const topY = A4_HEIGHT - 22;
    const w1 = font.widthOfTextAtSize(line1, 8);
    const w2 = font.widthOfTextAtSize(line2, 7.5);
    const w3 = font.widthOfTextAtSize(line3, 7.5);
    page.drawText(line1, {
      x: (A4_WIDTH - w1) / 2,
      y: topY,
      size: 8,
      font,
      color: green,
    });
    page.drawText(line2, {
      x: (A4_WIDTH - w2) / 2,
      y: topY - 10,
      size: 7.5,
      font,
      color: muted,
    });
    page.drawText(line3, {
      x: (A4_WIDTH - w3) / 2,
      y: topY - 20,
      size: 7.5,
      font,
      color: muted,
    });
    page.drawLine({
      start: { x: MARGIN, y: topY - 26 },
      end: { x: A4_WIDTH - MARGIN, y: topY - 26 },
      thickness: 0.7,
      color: green,
    });
  }

  const label = `Page ${pageNo} of ${total}`;
  const left =
    'Tura Public School, Tura · K.G. Admission - Academic Session 2027';
  const right = `${applicationNumber} · ${label}`;
  page.drawText(left, {
    x: MARGIN,
    y: 18,
    size: 8,
    font,
    color: green,
  });
  const rightWidth = font.widthOfTextAtSize(right, 8);
  page.drawText(right, {
    x: A4_WIDTH - MARGIN - rightWidth,
    y: 18,
    size: 8,
    font,
    color: green,
  });
}

export async function mergeSchoolApplicationPdfPackage(input: {
  formPdf: Buffer;
  attachments: PreparedAttachment[];
  applicationNumber: string;
  applicantName: string;
  meta?: SchoolPdfAttachmentMeta;
}): Promise<Buffer> {
  const formDoc = await PDFDocument.load(input.formPdf);
  const formPageCount = formDoc.getPageCount();

  if (!input.attachments.length) {
    const font = await formDoc.embedFont(StandardFonts.Helvetica);
    formDoc.getPages().forEach((page, idx) => {
      stampPageNumbers(
        page,
        font,
        idx + 1,
        formPageCount,
        input.applicationNumber,
      );
    });
    return Buffer.from(await formDoc.save());
  }

  const meta: SchoolPdfAttachmentMeta = input.meta ?? {
    applicationNumber: input.applicationNumber,
    applicantName: input.applicantName,
  };

  const attachmentsPdf = await buildCompactAttachmentsPdf({
    attachments: input.attachments,
    meta,
  });

  const out = await PDFDocument.create();
  const formPages = await out.copyPages(formDoc, formDoc.getPageIndices());
  for (const page of formPages) out.addPage(page);

  const attDoc = await PDFDocument.load(attachmentsPdf);
  const attPages = await out.copyPages(attDoc, attDoc.getPageIndices());
  for (const page of attPages) out.addPage(page);

  const font = await out.embedFont(StandardFonts.Helvetica);
  const total = out.getPageCount();
  out.getPages().forEach((page, idx) => {
    stampPageNumbers(page, font, idx + 1, total, input.applicationNumber);
  });

  return Buffer.from(await out.save());
}
