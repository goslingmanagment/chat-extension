// The Fansly catalogs of the Fansly CG codes (1.15.0, R20 P4a3; host:
// fansly-web): exactly the keys of the Fansly registry in both languages,
// plain texts, the shared catalog's vocabulary rules, and none of it in the
// ChatSpace catalog.

import { CG_FANSLY_CODES, CG_FANSLY_I18N_KEYS, cgFanslyEntry } from '@cg/contracts/errors-fansly';
import { I18N_KEYS, messageParams } from '@cg/contracts/i18n/catalog';
import { LOCALES, PLURAL_CATEGORIES } from '@cg/contracts/i18n/keys';
import { FANSLY_VAULT_PLURAL_KEYS, FANSLY_VAULT_TEXT_KEYS } from '@cg/contracts/vault-fansly';
import { describe, expect, it } from 'vitest';

import { CATALOGS } from '../../../i18n';
import { FANSLY_CG_CATALOGS, FANSLY_VAULT_TEXTS } from './index';

/** AU-019 (as in the shared catalog's test): a chatter never reads of tokens, keys or an API. */
const FORBIDDEN_WORDS: readonly RegExp[] = [/(?<!\p{L})tokens?(?!\p{L})/iu, /(?<!\p{L})токен/iu, /(?<!\p{L})keys?(?!\p{L})/iu, /(?<!\p{L})ключ/iu, /(?<!\p{L})api(?!\p{L})/iu, /(?<!\p{L})bearer/iu];

describe('[ER-004] [I18-003] Fansly CG texts (fansly-web)', () => {
  it('ru and en carry exactly the title and body of every Fansly code', () => {
    for (const locale of LOCALES) expect(Object.keys(FANSLY_CG_CATALOGS[locale]).sort(), locale).toEqual([...CG_FANSLY_I18N_KEYS].sort());
    for (const code of CG_FANSLY_CODES) {
      const entry = cgFanslyEntry(code);
      for (const locale of LOCALES) {
        expect(FANSLY_CG_CATALOGS[locale][entry.title].trim(), `${locale} ${code} title`).not.toBe('');
        expect(FANSLY_CG_CATALOGS[locale][entry.body].trim(), `${locale} ${code} body`).not.toBe('');
      }
    }
  });

  it('plain texts: no parameters (an error crosses runtimes as code and facts), no forbidden words', () => {
    for (const locale of LOCALES) {
      for (const [key, text] of Object.entries(FANSLY_CG_CATALOGS[locale])) {
        expect(messageParams(text), `${locale} ${key}`).toEqual([]);
        expect(FORBIDDEN_WORDS.filter((pattern) => pattern.test(text)), `${locale} ${key}: «${text}»`).toEqual([]);
      }
    }
  });

  it('the ChatSpace catalog carries none of them (R20 architecture §3.4)', () => {
    const shared = new Set<string>(I18N_KEYS);
    for (const key of CG_FANSLY_I18N_KEYS) {
      expect(shared.has(key), key).toBe(false);
      for (const locale of LOCALES) expect(key in CATALOGS[locale], `${locale} ${key}`).toBe(false);
    }
  });
});

describe('[I18-003] [FS-VLT-1] the vault panel’s texts (fansly-web, R20 P13b)', () => {
  it('ru and en carry exactly the panel’s keys, the same parameters in both, every plural form of the locale; none in the shared catalogs', () => {
    const shared = new Set<string>(I18N_KEYS);
    for (const locale of LOCALES) {
      const catalog = FANSLY_VAULT_TEXTS[locale] as Readonly<Record<string, unknown>>;
      expect(Object.keys(catalog).sort(), locale).toEqual([...FANSLY_VAULT_TEXT_KEYS, ...FANSLY_VAULT_PLURAL_KEYS].sort());
      for (const key of FANSLY_VAULT_TEXT_KEYS) {
        const text = catalog[key] as string;
        expect(text.trim(), `${locale} ${key}`).not.toBe('');
        expect(messageParams(text).sort(), `${locale} ${key}`).toEqual(messageParams(FANSLY_VAULT_TEXTS.ru[key]).sort());
        expect(FORBIDDEN_WORDS.filter((pattern) => pattern.test(text)), `${locale} ${key}: «${text}»`).toEqual([]);
      }
      for (const key of FANSLY_VAULT_PLURAL_KEYS) {
        const forms = catalog[key] as Readonly<Record<string, string>>;
        expect(Object.keys(forms).sort(), `${locale} ${key}`).toEqual([...PLURAL_CATEGORIES[locale]].sort());
        for (const form of Object.values(forms)) expect(messageParams(form), `${locale} ${key}`).toEqual(['n']);
      }
      for (const key of [...FANSLY_VAULT_TEXT_KEYS, ...FANSLY_VAULT_PLURAL_KEYS]) {
        expect(shared.has(key), key).toBe(false);
        expect(key in CATALOGS[locale], `${locale} ${key}`).toBe(false);
      }
    }
  });
});
