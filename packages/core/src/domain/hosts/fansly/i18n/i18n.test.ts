// The Fansly catalogs of the Fansly CG codes (1.15.0, R20 P4a3; host:
// fansly-web): exactly the keys of the Fansly registry in both languages,
// plain texts, the shared catalog's vocabulary rules, and none of it in the
// ChatSpace catalog. So too the words of the window check's marks (R20 P8b2),
// the vault panel's texts (P13b) and the extension pages' (P14b1).

import { CG_FANSLY_CODES, CG_FANSLY_I18N_KEYS, cgFanslyEntry } from '@cg/contracts/errors-fansly';
import { I18N_KEYS, messageParams } from '@cg/contracts/i18n/catalog';
import { LOCALES, PLURAL_CATEGORIES } from '@cg/contracts/i18n/keys';
import { FANSLY_PAGE_TEXT_KEYS } from '@cg/contracts/pages-fansly';
import { FANSLY_NEWCOMERS_TEXT_KEYS } from '@cg/contracts/newcomers-fansly';
import { FANSLY_VAULT_PLURAL_KEYS, FANSLY_VAULT_TEXT_KEYS } from '@cg/contracts/vault-fansly';
import { NEWCOMER_CHECK_FILTERS, NEWCOMER_CHECKS } from '@cg/contracts/vm';
import { describe, expect, it } from 'vitest';

import { CATALOGS, createI18n } from '../../../i18n';
import { FANSLY_CG_CATALOGS, FANSLY_MARK_TEXTS, FANSLY_VAULT_TEXTS } from './index';
import { FANSLY_NEWCOMERS_TEXTS, withFanslyNewcomersTexts } from './newcomers';
import { FANSLY_PAGE_TEXTS, fanslyPageText, withFanslyPageTexts } from './pages';

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

describe('[I18-003] the words of the window check’s marks (fansly-web, R20 P8b2; spec §3.5, ui-design §4.7)', () => {
  /** `ResultMarkKey` spelled out: a title and its continuation for each reason only Fansly’s verdict gives. */
  const MARK_KEYS = (['unverified', 'windowMiss', 'deletedServed'] as const).flatMap((reason) => [`result.stale.${reason}.title`, `result.stale.${reason}.body`]);

  it('ru and en carry exactly the marks’ keys: plain texts, no parameters, no forbidden words; none in the shared catalogs, whose «Фан написал новое» stays', () => {
    const shared = new Set<string>(I18N_KEYS);
    for (const locale of LOCALES) {
      expect(Object.keys(FANSLY_MARK_TEXTS[locale]).sort(), locale).toEqual([...MARK_KEYS].sort());
      for (const [key, text] of Object.entries(FANSLY_MARK_TEXTS[locale])) {
        expect(text.trim(), `${locale} ${key}`).not.toBe('');
        expect(messageParams(text), `${locale} ${key}`).toEqual([]);
        expect(FORBIDDEN_WORDS.filter((pattern) => pattern.test(text)), `${locale} ${key}: «${text}»`).toEqual([]);
        expect(shared.has(key), key).toBe(false);
        expect(key in CATALOGS[locale], `${locale} ${key}`).toBe(false);
      }
      expect(['result.stale.title', 'result.stale.body'].every((key) => key in CATALOGS[locale]), locale).toBe(true);
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

describe('[I18-003] Fansly’s texts on the extension pages (R20 P14b1, FS-SET-1)', () => {
  it('ru and en carry exactly the page keys, the same parameters in both, no forbidden words; none in the shared catalogs', () => {
    const shared = new Set<string>(I18N_KEYS);
    for (const locale of LOCALES) {
      expect(Object.keys(FANSLY_PAGE_TEXTS[locale]).sort(), locale).toEqual([...FANSLY_PAGE_TEXT_KEYS].sort());
      for (const key of FANSLY_PAGE_TEXT_KEYS) {
        const text = FANSLY_PAGE_TEXTS[locale][key];
        expect(text.trim(), `${locale} ${key}`).not.toBe('');
        expect(messageParams(text).sort(), `${locale} ${key}`).toEqual(messageParams(FANSLY_PAGE_TEXTS.ru[key]).sort());
        expect(FORBIDDEN_WORDS.filter((pattern) => pattern.test(text)), `${locale} ${key}: «${text}»`).toEqual([]);
        expect(shared.has(key), key).toBe(false);
        expect(key in CATALOGS[locale], `${locale} ${key}`).toBe(false);
      }
    }
  });

  it('laid over the page’s I18n: its own keys in the page’s language as it switches, every other key the page’s', () => {
    const base = createI18n({ language: 'ru', now: () => 0 });
    const i18n = withFanslyPageTexts(base);
    expect(fanslyPageText(i18n, 'fansly.pages.viaTab')).toBe('Fansly через вкладку');
    expect(fanslyPageText(i18n, 'fansly.pages.tabsOpen', { n: 3 })).toBe('Открыто: 3');
    expect(i18n.t('common.retry')).toBe(base.t('common.retry'));
    base.setLanguage('en');
    expect(i18n.language).toBe('en');
    expect(fanslyPageText(i18n, 'fansly.pages.viaTab')).toBe('Fansly through the tab');
    expect(i18n.t('common.retry')).toBe(base.t('common.retry'));
  });
});

describe('[I18-003] [NF-005] «Новые» on Fansly: the window’s texts (fansly-web, R20 P10a)', () => {
  it('ru and en carry exactly the window’s keys — a status for every verdict, a word for every filter —, the same parameters in both; none in the shared catalogs', () => {
    const shared = new Set<string>(I18N_KEYS);
    for (const check of NEWCOMER_CHECKS) expect(FANSLY_NEWCOMERS_TEXT_KEYS, check).toContain(`fansly.newcomers.status.${check}`);
    for (const filter of NEWCOMER_CHECK_FILTERS) expect(FANSLY_NEWCOMERS_TEXT_KEYS, filter).toContain(`fansly.newcomers.filter.${filter}`);
    for (const locale of LOCALES) {
      const catalog = FANSLY_NEWCOMERS_TEXTS[locale] as Readonly<Record<string, string>>;
      expect(Object.keys(catalog).sort(), locale).toEqual([...FANSLY_NEWCOMERS_TEXT_KEYS].sort());
      for (const key of FANSLY_NEWCOMERS_TEXT_KEYS) {
        const text = catalog[key] as string;
        expect(text.trim(), `${locale} ${key}`).not.toBe('');
        expect(messageParams(text).sort(), `${locale} ${key}`).toEqual(messageParams(FANSLY_NEWCOMERS_TEXTS.ru[key]).sort());
        expect(FORBIDDEN_WORDS.filter((pattern) => pattern.test(text)), `${locale} ${key}: «${text}»`).toEqual([]);
        expect(shared.has(key), key).toBe(false);
        expect(key in CATALOGS[locale], `${locale} ${key}`).toBe(false);
      }
    }
  });

  it('laid over the tab’s I18n: its own keys in the tab’s language at the moment of the call, every other key the tab’s', () => {
    const base = createI18n({ language: 'ru', now: () => 0, timeZone: 'UTC' });
    const i18n = withFanslyNewcomersTexts(base);
    const say = (key: string): string => i18n.t(key as never);
    expect([say('fansly.newcomers.status.reply'), i18n.t('common.retry')]).toEqual(['Ждёт ответа', 'Повторить']);
    base.setLanguage('en');
    expect([i18n.language, say('fansly.newcomers.status.reply'), i18n.t('common.retry')]).toEqual(['en', 'Waits for a reply', 'Retry']);
  });
});
