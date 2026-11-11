/**
 * IST (Asia/Kolkata, UTC+05:30) date utilities.
 * India Standard Time has fixed offset +05:30 (+330 minutes) with no DST.
 */

const IST_OFFSET_MS = 330 * 60 * 1000;

const EN_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const HI_MONTHS = [
  'जनवरी',
  'फ़रवरी',
  'मार्च',
  'अप्रैल',
  'मई',
  'जून',
  'जुलाई',
  'अगस्त',
  'सितंबर',
  'अक्टूबर',
  'नवंबर',
  'दिसंबर',
] as const;

const IST_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Validates and parses a YYYY-MM-DD calendar date string into { year, month, day }.
 */
export function parseIstDateParts(istDate: string): {
  year: number;
  month: number;
  day: number;
} {
  const match = IST_DATE_REGEX.exec(istDate);
  if (!match) {
    throw new Error(`Invalid IST date format (expected YYYY-MM-DD): ${istDate}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) {
    throw new Error(`Invalid month in IST date: ${istDate}`);
  }
  const maxDay = daysInMonth(year, month);
  if (day < 1 || day > maxDay) {
    throw new Error(`Invalid day in IST date: ${istDate}`);
  }
  return { year, month, day };
}

/**
 * Converts a JS Date instant to its IST calendar date string (YYYY-MM-DD).
 */
export function toIstDateString(date: Date = new Date()): string {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns the number of calendar days in (year, month) where month is 1..12.
 */
export function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12 || !Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error(`Invalid year/month: ${year}-${month}`);
  }
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Formats an IST YYYY-MM-DD date as "5 March 2027" (or Hindi equivalent).
 */
export function formatDisplayDate(istDate: string, locale: 'en' | 'hi' = 'en'): string {
  const { year, month, day } = parseIstDateParts(istDate);
  const months = locale === 'hi' ? HI_MONTHS : EN_MONTHS;
  const monthName = months.at(month - 1);
  if (!monthName) {
    throw new Error(`Invalid month index: ${month}`);
  }
  return `${day} ${monthName} ${year}`;
}

/**
 * Formats an integer day-step difference between two IST YYYY-MM-DD dates (end - start).
 */
export function diffDaysIst(startIstDate: string, endIstDate: string): number {
  const s = parseIstDateParts(startIstDate);
  const e = parseIstDateParts(endIstDate);
  const msStart = Date.UTC(s.year, s.month - 1, s.day);
  const msEnd = Date.UTC(e.year, e.month - 1, e.day);
  return Math.round((msEnd - msStart) / 86_400_000);
}

/**
 * Adds `days` calendar days to an IST YYYY-MM-DD string.
 */
export function addDaysIst(istDate: string, days: number): string {
  const p = parseIstDateParts(istDate);
  const dt = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Adds `months` calendar months to an IST YYYY-MM-DD string, clamping day to end of target month.
 */
export function addMonthsIst(istDate: string, months: number): string {
  const p = parseIstDateParts(istDate);
  const totalMonths = p.year * 12 + (p.month - 1) + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;
  const clampedDay = Math.min(p.day, daysInMonth(targetYear, targetMonth));
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

/**
 * Computes the ISO 8601 week key ("YYYY-Www") for the IST calendar date.
 */
export function getIstIsoWeekKey(input: Date | string = new Date()): string {
  const istDate = typeof input === 'string' ? input : toIstDateString(input);
  const { year, month, day } = parseIstDateParts(istDate);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  const dayNum = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNum);
  const isoYear = utcDate.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const weekNo = Math.ceil(((utcDate.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(weekNo).padStart(2, '0')}`;
}

