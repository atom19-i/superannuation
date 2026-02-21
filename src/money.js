const MONEY_RE = /^([+-]?)(\d+)(?:\.(\d+))?$/;

function normalizeMoneyInput(raw) {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      throw new Error('must be a finite number');
    }
    return raw.toString();
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new Error('must not be empty');
    }
    return trimmed;
  }

  throw new Error('must be a number or numeric string');
}

export function parseMoney(raw) {
  const text = normalizeMoneyInput(raw);
  const match = text.match(MONEY_RE);

  if (!match) {
    throw new Error('must be a valid decimal value');
  }

  const sign = match[1] === '-' ? -1n : 1n;
  const intPart = BigInt(match[2]);
  const frac = (match[3] ?? '').replace(/\s+/g, '');

  const first = frac.length >= 1 ? Number(frac[0]) : 0;
  const second = frac.length >= 2 ? Number(frac[1]) : 0;
  const third = frac.length >= 3 ? Number(frac[2]) : 0;

  let cents = BigInt(first * 10 + second);

  // Half-up rounding to 2 decimals.
  if (third >= 5) {
    cents += 1n;
  }

  let whole = intPart;
  if (cents >= 100n) {
    whole += 1n;
    cents -= 100n;
  }

  return sign * (whole * 100n + cents);
}

export function moneyToNumber(paise) {
  return Number(paise) / 100;
}

export function moneyToFixed2(paise) {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const text = `${negative ? '-' : ''}${whole.toString()}.${frac.toString().padStart(2, '0')}`;
  return Number(text);
}

export function validateMoneyRange(paise, minInclusive, maxExclusive, fieldName) {
  if (paise < minInclusive || paise >= maxExclusive) {
    throw new Error(`${fieldName} out of allowed range`);
  }
}

export function ceilTo100(paise) {
  const multiple = 10000n;
  const remainder = paise % multiple;
  if (remainder === 0n) {
    return paise;
  }
  return paise + (multiple - remainder);
}

export function bigintMin(...values) {
  return values.reduce((acc, value) => (value < acc ? value : acc));
}
