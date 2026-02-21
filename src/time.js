export const TIMESTAMP_FORMAT = 'YYYY-MM-DD HH:mm:ss';
const TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const IST_OFFSET_SECONDS = 5 * 3600 + 30 * 60;

export function parseTimestampToEpochSeconds(value, fieldName = 'timestamp') {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string in format ${TIMESTAMP_FORMAT}`);
  }

  const trimmed = value.trim();
  const match = trimmed.match(TIMESTAMP_RE);

  if (!match) {
    throw new Error(`${fieldName} must follow ${TIMESTAMP_FORMAT}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const asUtc = new Date(utcMs);

  // Reject invalid date overflows like Feb 30.
  if (
    asUtc.getUTCFullYear() !== year ||
    asUtc.getUTCMonth() + 1 !== month ||
    asUtc.getUTCDate() !== day ||
    asUtc.getUTCHours() !== hour ||
    asUtc.getUTCMinutes() !== minute ||
    asUtc.getUTCSeconds() !== second
  ) {
    throw new Error(`${fieldName} is not a valid calendar timestamp`);
  }

  return Math.floor((utcMs - IST_OFFSET_SECONDS * 1000) / 1000);
}

export function formatEpochSecondsToTimestamp(epochSeconds) {
  const localMs = epochSeconds * 1000 + IST_OFFSET_SECONDS * 1000;
  const d = new Date(localMs);

  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hour = String(d.getUTCHours()).padStart(2, '0');
  const minute = String(d.getUTCMinutes()).padStart(2, '0');
  const second = String(d.getUTCSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

export function parseTimestampLike(value, fallbackValue, fieldName) {
  const chosen = typeof value === 'string' ? value : fallbackValue;
  if (typeof chosen !== 'string') {
    throw new Error(`${fieldName} is required`);
  }
  return chosen;
}
