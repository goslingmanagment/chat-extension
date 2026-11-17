// UP-007, the release half of «AI lives only in the hub»: the extension's source
// talks to no AI vendor. The model and its keys are the hub's; a chatter has a
// login and a password. (That the hub SDK stays in the background and the
// manifest names no other host is `pnpm gates` and the manifest test.)

import { describe, expect, it } from 'vitest';

import { readSources } from '../lib/files.ts';

const VENDOR_ENDPOINTS = /api\.anthropic\.com|console\.anthropic\.com|openrouter\.ai|api\.openai\.com|generativelanguage\.googleapis\.com|api\.mistral\.ai|api\.x\.ai/i;

describe('AI only through the hub', () => {
  it('[UP-007] the extension’s source names no AI vendor endpoint', () => {
    const sources = readSources();
    expect(sources.length).toBeGreaterThan(100);
    expect(sources.filter((file) => VENDOR_ENDPOINTS.test(file.text)).map((file) => file.path)).toEqual([]);
  });

  it('the pattern does catch what it is for', () => {
    for (const bad of ['fetch("https://api.anthropic.com/v1/messages")', 'https://openrouter.ai/api/v1']) expect(VENDOR_ENDPOINTS.test(bad), bad).toBe(true);
  });
});
