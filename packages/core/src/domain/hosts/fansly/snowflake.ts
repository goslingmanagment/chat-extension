// FS-REG-2: decode the ACCOUNT id, never the conversation's group id.
const EPOCH_MS = 1561494360000;

export function fanslyIdTimestampMs(value: string, now = Date.now()): number | null {
  if (!/^[1-9]\d{0,23}$/.test(value)) return null;
  const ms = Number(BigInt(value) >> 22n) + EPOCH_MS;
  return Number.isSafeInteger(ms) && ms > EPOCH_MS && ms <= now + 60_000 ? ms : null;
}

export function fanslyRegistrationDate(fanId: string): string | null {
  const ms = fanslyIdTimestampMs(fanId);
  return ms === null ? null : new Date(ms).toISOString();
}
