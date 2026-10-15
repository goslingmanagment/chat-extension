import { expect, it } from 'vitest';
import { createRedactor, sanitizeValue } from './redact';
it('[host:fansly] [LG-003] [FS-PRIV-2] strips session header values from both structured fields and labelled text', () => {
  const headers = { authorization: 'synthetic-authorization-value', 'fansly-client-id': 'synthetic-client-value', 'fansly-client-ts': 'synthetic-clock-value', 'fansly-client-check': 'synthetic-check-value', 'fansly-session-id': 'synthetic-session-value', cookie: 'synthetic-cookie-value' };
  const redactor = createRedactor();
  const structured = JSON.stringify(sanitizeValue({ nested: headers }, redactor));
  const line = redactor.text(Object.entries(headers).map(([key, value]) => `${key}=${value}`).join('; '));
  for (const value of Object.values(headers)) { expect(structured).not.toContain(value); expect(line).not.toContain(value); }
});
