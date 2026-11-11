/**
 * Integer-only monetary helpers (all amounts stored as integer paise; 1 INR = 100 paise).
 * Zero floating-point arithmetic is used in any calculation or formatting.
 */

export const PAISE_PER_RUPEE = 100;

/**
 * Rounds a non-negative rational value numerator / denominator to the nearest integer
 * using round half up: floor((2 * num + den) / (2 * den)).
 * Implemented strictly with BigInt arithmetic to prevent intermediate overflow.
 */
export function roundHalfUp(numerator: bigint | number, denominator: bigint | number): number {
  const num = typeof numerator === 'bigint' ? numerator : BigInt(Math.trunc(numerator));
  const den = typeof denominator === 'bigint' ? denominator : BigInt(Math.trunc(denominator));

  if (typeof numerator === 'number' && !Number.isSafeInteger(numerator)) {
    throw new Error('roundHalfUp numerator must be a safe integer');
  }
  if (typeof denominator === 'number' && !Number.isSafeInteger(denominator)) {
    throw new Error('roundHalfUp denominator must be a safe integer');
  }
  if (den <= 0n) {
    throw new Error('roundHalfUp denominator must be positive');
  }
  if (num < 0n) {
    throw new Error('roundHalfUp numerator must be non-negative');
  }

  const rounded = (2n * num + den) / (2n * den);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Rounded result exceeds Number.MAX_SAFE_INTEGER');
  }
  return Number(rounded);
}

/**
 * Splits `totalPaise` across weighted items using the largest remainder (Hamilton) method
 * so that the sum of parts equals `totalPaise` exactly. Ties in remainder are broken
 * deterministically by `id` ascending.
 */
export function splitLargestRemainder(
  totalPaise: number,
  items: ReadonlyArray<{ id: string; weight: bigint | number }>
): Array<{ id: string; amountPaise: number }> {
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 0) {
    throw new Error('totalPaise must be a non-negative safe integer');
  }
  if (items.length === 0) {
    if (totalPaise === 0) return [];
    throw new Error('Cannot split a positive pool across zero items');
  }

  const normalized = items.map((item, idx) => {
    const w = typeof item.weight === 'bigint' ? item.weight : BigInt(item.weight);
    if (typeof item.weight === 'number' && !Number.isSafeInteger(item.weight)) {
      throw new Error('Weight must be a safe integer');
    }
    if (w < 0n) {
      throw new Error('Weight must be non-negative');
    }
    return { id: item.id, weight: w, originalIndex: idx };
  });

  const totalWeight = normalized.reduce((acc, item) => acc + item.weight, 0n);
  if (totalWeight === 0n) {
    if (totalPaise === 0) {
      return normalized.map((item) => ({ id: item.id, amountPaise: 0 }));
    }
    throw new Error('Cannot split a positive pool across zero total weight');
  }

  const poolBig = BigInt(totalPaise);
  const baseShares = normalized.map((item) => {
    const product = poolBig * item.weight;
    return {
      id: item.id,
      originalIndex: item.originalIndex,
      floorAmount: Number(product / totalWeight),
      remainderNumerator: product % totalWeight,
    };
  });

  const allocatedSum = baseShares.reduce((acc, item) => acc + item.floorAmount, 0);
  const leftover = totalPaise - allocatedSum;

  const ranked = [...baseShares].sort((a, b) => {
    if (b.remainderNumerator > a.remainderNumerator) return 1;
    if (b.remainderNumerator < a.remainderNumerator) return -1;
    return a.id.localeCompare(b.id, 'en');
  });

  const extraIds = new Set<number>();
  for (let i = 0; i < leftover; i++) {
    const target = ranked.at(i);
    if (target) {
      extraIds.add(target.originalIndex);
    }
  }

  return baseShares.map((item) => ({
    id: item.id,
    amountPaise: item.floorAmount + (extraIds.has(item.originalIndex) ? 1 : 0),
  }));
}

/**
 * Formats non-negative digits using Indian number grouping (e.g. "123456" -> "1,23,456").
 */
export function formatIndianDigits(wholeStr: string): string {
  if (!/^\d+$/.test(wholeStr)) {
    throw new Error('Expected digits string');
  }
  if (wholeStr.length <= 3) return wholeStr;
  const lastThree = wholeStr.slice(-3);
  const prefix = wholeStr.slice(0, -3);
  const pairs: string[] = [];
  for (let i = prefix.length; i > 0; i -= 2) {
    const start = Math.max(0, i - 2);
    pairs.unshift(prefix.slice(start, i));
  }
  return `${pairs.join(',')},${lastThree}`;
}

/**
 * Formats integer paise into Indian Rupee display format (e.g. 12345600 -> "₹1,23,456").
 */
export function formatPaiseToInr(
  paise: number,
  options: { showPaise?: boolean } = {}
): string {
  if (!Number.isSafeInteger(paise)) {
    throw new Error('paise must be a safe integer');
  }
  const sign = paise < 0 ? '-' : '';
  const absPaise = Math.abs(paise);
  const wholeRupees = Math.floor(absPaise / PAISE_PER_RUPEE);
  const remPaise = absPaise % PAISE_PER_RUPEE;
  const formattedWhole = formatIndianDigits(String(wholeRupees));

  if (options.showPaise || remPaise > 0) {
    return `${sign}₹${formattedWhole}.${String(remPaise).padStart(2, '0')}`;
  }
  return `${sign}₹${formattedWhole}`;
}

/**
 * Strictly parses a whole-rupee positive integer input (rejects zero, negatives, decimals,
 * commas, exponent notation, and whitespace-padded junk) into integer paise.
 */
export function parseStrictIntegerRupeesToPaise(raw: string | number): number {
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw) || raw <= 0) {
      throw new Error('Amount in rupees must be a positive whole integer');
    }
    const paise = raw * PAISE_PER_RUPEE;
    if (!Number.isSafeInteger(paise)) {
      throw new Error('Amount exceeds safe integer limit');
    }
    return paise;
  }

  if (typeof raw !== 'string') {
    throw new Error('Amount must be a positive whole integer');
  }
  const trimmed = raw.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(
      'Amount must be a positive whole rupee integer without decimals, commas, or exponents'
    );
  }
  const rupees = Number(trimmed);
  if (!Number.isSafeInteger(rupees) || rupees <= 0) {
    throw new Error('Amount exceeds safe integer limit');
  }
  const paise = rupees * PAISE_PER_RUPEE;
  if (!Number.isSafeInteger(paise)) {
    throw new Error('Amount exceeds safe integer limit');
  }
  return paise;
}

/**
 * Strictly validates an integer paise input (rejects zero, negative, float, string, exponent).
 */
export function parseStrictPaise(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0) {
    throw new Error('amountPaise must be a positive safe integer');
  }
  return raw;
}

