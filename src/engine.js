import {
  parseMoney,
  moneyToFixed2,
  validateMoneyRange,
  ceilTo100,
  bigintMin,
  moneyToNumber
} from './money.js';
import { parseTimestampLike, parseTimestampToEpochSeconds } from './time.js';

const MAX_RECORDS = 1_000_000;
const MAX_AMOUNT_RUPEES = 500_000n;
const MAX_AMOUNT_PAISE = MAX_AMOUNT_RUPEES * 100n;
const NPS_RATE = 0.0711;
const INDEX_RATE = 0.1449;
const NPS_DEDUCTION_CAP_RUPEES = 200_000;

class ApiError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export { ApiError };

function assertArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new ApiError(400, `${fieldName} must be an array`);
  }
  if (value.length > MAX_RECORDS) {
    throw new ApiError(400, `${fieldName} cannot exceed ${MAX_RECORDS} records`);
  }
  return value;
}

function getTimestampField(record) {
  return parseTimestampLike(record?.timestamp, record?.date, 'timestamp');
}

function parseNumericField(raw, path) {
  try {
    return parseMoney(raw);
  } catch (error) {
    throw new ApiError(400, `${path} ${error.message}`);
  }
}

function parsePeriodTimestamp(raw, path) {
  try {
    return parseTimestampToEpochSeconds(raw, path);
  } catch (error) {
    throw new ApiError(400, error.message);
  }
}

function buildTransactionFromExpense(expense, index) {
  let timestamp;
  try {
    timestamp = getTimestampField(expense);
  } catch (error) {
    throw new ApiError(400, `expenses[${index}].${error.message}`);
  }

  let epochSeconds;
  try {
    epochSeconds = parseTimestampToEpochSeconds(timestamp, `expenses[${index}].timestamp`);
  } catch (error) {
    throw new ApiError(400, error.message);
  }

  const amountPaise = parseNumericField(expense?.amount, `expenses[${index}].amount`);
  validateMoneyRange(amountPaise, 0n, MAX_AMOUNT_PAISE, `expenses[${index}].amount`);

  const ceilingPaise = ceilTo100(amountPaise);
  const remanentBasePaise = ceilingPaise - amountPaise;

  return {
    timestamp,
    epochSeconds,
    amountPaise,
    ceilingPaise,
    remanentBasePaise,
    remanentFinalPaise: remanentBasePaise,
    inputIndex: index
  };
}

function parseTransactionInput(transaction, index, sourceField = 'transactions') {
  const txPath = `${sourceField}[${index}]`;

  let timestamp;
  try {
    timestamp = getTimestampField(transaction);
  } catch (error) {
    throw new ApiError(400, `${txPath}.${error.message}`);
  }

  let epochSeconds;
  try {
    epochSeconds = parseTimestampToEpochSeconds(timestamp, `${txPath}.timestamp`);
  } catch (error) {
    throw new ApiError(400, error.message);
  }

  const amountPaise = parseNumericField(transaction?.amount, `${txPath}.amount`);
  validateMoneyRange(amountPaise, 0n, MAX_AMOUNT_PAISE, `${txPath}.amount`);

  const ceilingPaise = transaction?.ceiling !== undefined
    ? parseNumericField(transaction?.ceiling, `${txPath}.ceiling`)
    : ceilTo100(amountPaise);

  if (ceilingPaise < amountPaise) {
    throw new ApiError(400, `${txPath}.ceiling cannot be less than amount`);
  }

  const hundredPaise = 10000n;
  if (ceilingPaise % hundredPaise !== 0n) {
    throw new ApiError(400, `${txPath}.ceiling must be a multiple of 100`);
  }

  const remanentBasePaise = ceilingPaise - amountPaise;

  return {
    timestamp,
    epochSeconds,
    amountPaise,
    ceilingPaise,
    remanentBasePaise,
    remanentFinalPaise: remanentBasePaise,
    inputIndex: index
  };
}

function serializeTransaction(transaction) {
  return {
    timestamp: transaction.timestamp,
    amount: moneyToFixed2(transaction.amountPaise),
    ceiling: moneyToFixed2(transaction.ceilingPaise),
    remanent: moneyToFixed2(transaction.remanentFinalPaise),
    remanentBase: moneyToFixed2(transaction.remanentBasePaise),
    remanentFinal: moneyToFixed2(transaction.remanentFinalPaise)
  };
}

function buildInvalidTransaction(record, code, message) {
  return {
    transaction: record,
    code,
    message
  };
}

function parseQPeriods(periods) {
  return periods.map((period, index) => {
    const fixedPaise = parseNumericField(period?.fixed, `q[${index}].fixed`);
    validateMoneyRange(fixedPaise, 0n, MAX_AMOUNT_PAISE, `q[${index}].fixed`);

    const start = parsePeriodTimestamp(period?.start, `q[${index}].start`);
    const end = parsePeriodTimestamp(period?.end, `q[${index}].end`);

    if (start > end) {
      throw new ApiError(400, `q[${index}] start cannot be after end`);
    }

    return {
      id: period?.id ?? `q-${index}`,
      fixedPaise,
      start,
      end,
      inputOrder: index
    };
  });
}

function parsePPeriods(periods) {
  return periods.map((period, index) => {
    const extraPaise = parseNumericField(period?.extra, `p[${index}].extra`);
    validateMoneyRange(extraPaise, 0n, MAX_AMOUNT_PAISE, `p[${index}].extra`);

    const start = parsePeriodTimestamp(period?.start, `p[${index}].start`);
    const end = parsePeriodTimestamp(period?.end, `p[${index}].end`);

    if (start > end) {
      throw new ApiError(400, `p[${index}] start cannot be after end`);
    }

    return {
      id: period?.id ?? `p-${index}`,
      extraPaise,
      start,
      end
    };
  });
}

function parseKPeriods(periods) {
  return periods.map((period, index) => {
    const start = parsePeriodTimestamp(period?.start, `k[${index}].start`);
    const end = parsePeriodTimestamp(period?.end, `k[${index}].end`);

    if (start > end) {
      throw new ApiError(400, `k[${index}] start cannot be after end`);
    }

    return {
      id: period?.id ?? `k-${index}`,
      start,
      end,
      startText: period?.start,
      endText: period?.end,
      inputOrder: index
    };
  });
}

class BinaryHeap {
  constructor(compareFn) {
    this.compareFn = compareFn;
    this.data = [];
  }

  size() {
    return this.data.length;
  }

  peek() {
    return this.data[0];
  }

  push(value) {
    this.data.push(value);
    this.bubbleUp(this.data.length - 1);
  }

  pop() {
    if (this.data.length === 0) return undefined;

    const top = this.data[0];
    const last = this.data.pop();

    if (this.data.length > 0 && last !== undefined) {
      this.data[0] = last;
      this.bubbleDown(0);
    }

    return top;
  }

  bubbleUp(index) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compareFn(this.data[index], this.data[parent]) <= 0) {
        break;
      }
      [this.data[index], this.data[parent]] = [this.data[parent], this.data[index]];
      index = parent;
    }
  }

  bubbleDown(index) {
    const length = this.data.length;

    while (true) {
      let largest = index;
      const left = 2 * index + 1;
      const right = 2 * index + 2;

      if (left < length && this.compareFn(this.data[left], this.data[largest]) > 0) {
        largest = left;
      }

      if (right < length && this.compareFn(this.data[right], this.data[largest]) > 0) {
        largest = right;
      }

      if (largest === index) {
        break;
      }

      [this.data[index], this.data[largest]] = [this.data[largest], this.data[index]];
      index = largest;
    }
  }
}

function applyQPeriods(transactions, qPeriods, sortedTransactionIndices) {
  if (qPeriods.length === 0) {
    return;
  }

  const sortedQ = [...qPeriods].sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start;
    }
    return a.inputOrder - b.inputOrder;
  });

  const heap = new BinaryHeap((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start;
    }
    // Higher priority to first input occurrence.
    return b.inputOrder - a.inputOrder;
  });

  let qPointer = 0;

  for (const txIndex of sortedTransactionIndices) {
    const tx = transactions[txIndex];
    const ts = tx.epochSeconds;

    while (qPointer < sortedQ.length && sortedQ[qPointer].start <= ts) {
      heap.push(sortedQ[qPointer]);
      qPointer += 1;
    }

    while (heap.size() > 0 && heap.peek().end < ts) {
      heap.pop();
    }

    if (heap.size() > 0) {
      tx.remanentFinalPaise = heap.peek().fixedPaise;
    } else {
      tx.remanentFinalPaise = tx.remanentBasePaise;
    }
  }
}

function applyPPeriods(transactions, pPeriods, sortedTransactionIndices) {
  if (pPeriods.length === 0) {
    return;
  }

  const events = [];

  for (const period of pPeriods) {
    events.push({ time: period.start, delta: period.extraPaise });
    events.push({ time: period.end + 1, delta: -period.extraPaise });
  }

  events.sort((a, b) => a.time - b.time);

  let activeExtra = 0n;
  let eventPointer = 0;

  for (const txIndex of sortedTransactionIndices) {
    const tx = transactions[txIndex];
    const ts = tx.epochSeconds;

    while (eventPointer < events.length && events[eventPointer].time <= ts) {
      activeExtra += events[eventPointer].delta;
      eventPointer += 1;
    }

    tx.remanentFinalPaise += activeExtra;
  }
}

function lowerBound(array, target) {
  let left = 0;
  let right = array.length;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (array[mid] < target) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  return left;
}

function upperBound(array, target) {
  let left = 0;
  let right = array.length;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (array[mid] <= target) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  return left;
}

function buildSavingsByKPeriods(transactions, kPeriods) {
  const sortedTransactions = [...transactions].sort((a, b) => a.epochSeconds - b.epochSeconds);
  const times = sortedTransactions.map((tx) => tx.epochSeconds);

  const prefix = new Array(sortedTransactions.length + 1);
  prefix[0] = 0n;
  for (let i = 0; i < sortedTransactions.length; i += 1) {
    prefix[i + 1] = prefix[i] + sortedTransactions[i].remanentFinalPaise;
  }

  return kPeriods.map((period) => {
    const left = lowerBound(times, period.start);
    const rightExclusive = upperBound(times, period.end);
    const sum = prefix[rightExclusive] - prefix[left];

    return {
      start: period.startText,
      end: period.endText,
      amountPaise: sum
    };
  });
}

function parseAndValidateTransactionsForValidation(payload) {
  const rawTransactions = assertArray(payload?.transactions, 'transactions');
  const invalid = [];
  const valid = [];
  const duplicates = [];
  const seen = new Map();

  for (let i = 0; i < rawTransactions.length; i += 1) {
    const raw = rawTransactions[i];

    let tx;
    try {
      tx = parseTransactionInput(raw, i);
    } catch (error) {
      if (error instanceof ApiError) {
        invalid.push(buildInvalidTransaction(raw, 'INVALID_TRANSACTION', error.message));
        continue;
      }
      throw error;
    }

    const serialized = serializeTransaction(tx);

    if (seen.has(tx.timestamp)) {
      invalid.push(
        buildInvalidTransaction(
          serialized,
          'DUPLICATE_TIMESTAMP',
          `Duplicate timestamp with transactions[${seen.get(tx.timestamp)}]`
        )
      );
      duplicates.push(serialized);
      continue;
    }

    seen.set(tx.timestamp, i);

    // Validator-specific consistency checks.
    const remanentInPayload = raw?.remanent;
    if (remanentInPayload !== undefined) {
      const remanentPaise = parseNumericField(raw?.remanent, `transactions[${i}].remanent`);
      if (remanentPaise !== tx.remanentBasePaise) {
        invalid.push(
          buildInvalidTransaction(
            serialized,
            'REMANENT_MISMATCH',
            'remanent must equal ceiling - amount'
          )
        );
        continue;
      }
    }

    valid.push(tx);
  }

  return { valid, invalid, duplicates };
}

function parseForFiltering(payload) {
  const rawTransactions = assertArray(payload?.transactions, 'transactions');
  const rawQ = assertArray(payload?.q ?? [], 'q');
  const rawP = assertArray(payload?.p ?? [], 'p');
  const rawK = assertArray(payload?.k ?? [], 'k');

  const invalid = [];
  const validTransactions = [];
  const seen = new Map();

  for (let i = 0; i < rawTransactions.length; i += 1) {
    const raw = rawTransactions[i];

    let tx;
    try {
      tx = parseTransactionInput(raw, i);
    } catch (error) {
      if (error instanceof ApiError) {
        invalid.push(buildInvalidTransaction(raw, 'INVALID_TRANSACTION', error.message));
        continue;
      }
      throw error;
    }

    if (seen.has(tx.timestamp)) {
      invalid.push(
        buildInvalidTransaction(
          raw,
          'DUPLICATE_TIMESTAMP',
          `Duplicate timestamp with transactions[${seen.get(tx.timestamp)}]`
        )
      );
      continue;
    }

    seen.set(tx.timestamp, i);
    validTransactions.push(tx);
  }

  const qPeriods = parseQPeriods(rawQ);
  const pPeriods = parsePPeriods(rawP);
  const kPeriods = parseKPeriods(rawK);

  return { validTransactions, invalid, qPeriods, pPeriods, kPeriods };
}

function applyTemporalRules(validTransactions, qPeriods, pPeriods, kPeriods) {
  const sortedTransactionIndices = validTransactions
    .map((_, index) => index)
    .sort((a, b) => validTransactions[a].epochSeconds - validTransactions[b].epochSeconds);

  applyQPeriods(validTransactions, qPeriods, sortedTransactionIndices);
  applyPPeriods(validTransactions, pPeriods, sortedTransactionIndices);

  const savingsByDates = buildSavingsByKPeriods(validTransactions, kPeriods).map((entry) => ({
    start: entry.start,
    end: entry.end,
    amount: moneyToFixed2(entry.amountPaise),
    amountPaise: entry.amountPaise
  }));

  return savingsByDates;
}

function normalizeInflation(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ApiError(400, 'inflation must be a finite number');
  }
  if (value < 0) {
    throw new ApiError(400, 'inflation cannot be negative');
  }

  return value > 1 ? value / 100 : value;
}

function parseAge(value) {
  if (!Number.isInteger(value)) {
    throw new ApiError(400, 'age must be an integer');
  }
  if (value < 0 || value > 120) {
    throw new ApiError(400, 'age must be between 0 and 120');
  }
  return value;
}

function taxForIncome(income) {
  if (income <= 700000) return 0;

  if (income <= 1000000) {
    return (income - 700000) * 0.10;
  }

  if (income <= 1200000) {
    return 300000 * 0.10 + (income - 1000000) * 0.15;
  }

  if (income <= 1500000) {
    return 300000 * 0.10 + 200000 * 0.15 + (income - 1200000) * 0.20;
  }

  return 300000 * 0.10 + 200000 * 0.15 + 300000 * 0.20 + (income - 1500000) * 0.30;
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function totalsFromTransactions(transactions) {
  let amount = 0n;
  let ceiling = 0n;
  let remanent = 0n;

  for (const tx of transactions) {
    amount += tx.amountPaise;
    ceiling += tx.ceilingPaise;
    remanent += tx.remanentFinalPaise;
  }

  return {
    transactionsTotalAmount: moneyToFixed2(amount),
    transactionsTotalCeiling: moneyToFixed2(ceiling),
    transactionsTotalRemanent: moneyToFixed2(remanent)
  };
}

export function parseTransactions(payload) {
  const expenses = assertArray(payload?.expenses, 'expenses');

  const transactions = expenses.map((expense, index) => buildTransactionFromExpense(expense, index));

  let totalAmount = 0n;
  let totalCeiling = 0n;
  let totalRemanent = 0n;

  for (const tx of transactions) {
    totalAmount += tx.amountPaise;
    totalCeiling += tx.ceilingPaise;
    totalRemanent += tx.remanentBasePaise;
  }

  return {
    transactions: transactions.map(serializeTransaction),
    transactionsTotalAmount: moneyToFixed2(totalAmount),
    transactionsTotalCeiling: moneyToFixed2(totalCeiling),
    transactionsTotalRemanent: moneyToFixed2(totalRemanent)
  };
}

export function validateTransactions(payload) {
  parseNumericField(payload?.wage, 'wage');

  const { valid, invalid, duplicates } = parseAndValidateTransactionsForValidation(payload);

  return {
    valid: valid.map(serializeTransaction),
    invalid,
    duplicates
  };
}

function processFiltering(payload) {
  const { validTransactions, invalid, qPeriods, pPeriods, kPeriods } = parseForFiltering(payload);

  const savingsByDates = applyTemporalRules(validTransactions, qPeriods, pPeriods, kPeriods);

  return {
    validTransactions,
    invalid,
    savingsByDates
  };
}

export function filterTransactions(payload) {
  const { validTransactions, invalid, savingsByDates } = processFiltering(payload);

  return {
    valid: validTransactions.map(serializeTransaction),
    invalid,
    savingsByDates: savingsByDates.map(({ amountPaise, ...rest }) => rest),
    ...totalsFromTransactions(validTransactions)
  };
}

export function calculateReturns(payload, instrument) {
  if (instrument !== 'nps' && instrument !== 'index') {
    throw new ApiError(500, 'Unsupported instrument');
  }

  const age = parseAge(payload?.age);
  const inflationRate = normalizeInflation(payload?.inflation);
  const wagePaise = parseNumericField(payload?.wage, 'wage');

  if (wagePaise <= 0n) {
    throw new ApiError(400, 'wage must be greater than 0');
  }

  const years = age < 60 ? 60 - age : 5;
  const annualIncome = moneyToNumber(wagePaise) * 12;
  const annualNpsCap = annualIncome * 0.10;

  const { validTransactions, savingsByDates } = processFiltering(payload);

  const growthRate = instrument === 'nps' ? NPS_RATE : INDEX_RATE;

  const enrichedSavings = savingsByDates.map((entry) => {
    const principal = moneyToNumber(entry.amountPaise);
    const nominal = principal * ((1 + growthRate) ** years);
    const profits = nominal - principal;
    const realValue = nominal / ((1 + inflationRate) ** years);

    let taxBenefit = 0;
    if (instrument === 'nps') {
      const eligibleDeduction = Math.min(principal, annualNpsCap, NPS_DEDUCTION_CAP_RUPEES);
      taxBenefit = taxForIncome(annualIncome) - taxForIncome(Math.max(annualIncome - eligibleDeduction, 0));
    }

    return {
      start: entry.start,
      end: entry.end,
      amount: round2(principal),
      profits: round2(profits),
      taxBenefit: round2(taxBenefit),
      realValue: round2(realValue)
    };
  });

  return {
    ...totalsFromTransactions(validTransactions),
    savingsByDates: enrichedSavings
  };
}
