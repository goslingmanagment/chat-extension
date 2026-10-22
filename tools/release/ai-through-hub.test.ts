// UP-007, the release half of «AI lives only in the hub»: nothing that ships —
// the extension's source, the site, the changelog, the notes — talks to an AI vendor,
// names one to a chatter or asks a chatter for a key. The model and its keys
// are the hub's; a chatter has a login and a password. (That the hub SDK stays
// in the background and the manifest names no other host is `pnpm gates` and
// the manifest test.)

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readSources } from '../lib/files.ts';
import { NOTES_DIR } from './changes.ts';
import { CHANGELOG_FILE, REPO_ROOT, SITE_DIR } from './config.ts';

const VENDOR_ENDPOINTS = /api\.anthropic\.com|console\.anthropic\.com|openrouter\.ai|api\.openai\.com|generativelanguage\.googleapis\.com|api\.mistral\.ai|api\.x\.ai/i;
/** What a page for chatters must not say: a provider's name, or an instruction to get or enter a key. */
const VENDOR_WORDS = /\b(?:Claude|Anthropic|OpenAI|OpenRouter|ChatGPT|GPT-\d|Gemini|Mistral)\b|API[- ]?(?:ключ|key)|Введите [^ .]*ключ/i;

describe('AI only through the hub', () => {
  it('[UP-007] the extension’s source names no AI vendor endpoint', () => {
    const sources = readSources();
    expect(sources.length).toBeGreaterThan(100);
    expect(sources.filter((file) => VENDOR_ENDPOINTS.test(file.text)).map((file) => file.path)).toEqual([]);
  });

  it('[UP-007] the site, the changelog and the notes of changes name no AI vendor and ask a chatter for no key', () => {
    const siteDir = join(REPO_ROOT, SITE_DIR);
    const notes = readdirSync(join(REPO_ROOT, NOTES_DIR)).filter((name) => name.endsWith('.md')).map((name) => join(NOTES_DIR, name));
    const texts = [...readdirSync(siteDir).map((name) => join(SITE_DIR, name)), CHANGELOG_FILE, ...notes].map((path) => ({ path, text: readFileSync(join(REPO_ROOT, path), 'utf8') }));
    const found = texts.flatMap((file) => {
      const match = VENDOR_ENDPOINTS.exec(file.text) ?? VENDOR_WORDS.exec(file.text);
      return match === null ? [] : [`${file.path}: «${match[0]}»`];
    });
    expect(found).toEqual([]);
  });

  it('the patterns do catch what they are for', () => {
    for (const bad of ['fetch("https://api.anthropic.com/v1/messages")', 'https://openrouter.ai/api/v1']) expect(VENDOR_ENDPOINTS.test(bad), bad).toBe(true);
    for (const bad of ['Ответ пишет Claude', 'Введите API-ключ', 'вставьте API key', 'Введите OpenRouter-ключ']) expect(VENDOR_WORDS.test(bad), bad).toBe(true);
    for (const good of ['Ключ устройства действует', 'AI перегружен', 'хаб ChatGoose']) expect(VENDOR_WORDS.test(good), good).toBe(false);
  });
});
