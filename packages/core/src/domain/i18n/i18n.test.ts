// Catalog checks of architecture.md §9.7: key parity ru/en, plural forms
// through Intl.PluralRules, no machinery words in UI texts (AU-019), product
// terms in Latin (I18-002), every CG title and body present.

import { describe, expect, it } from 'vitest';

import { CG_CODES } from '@cg/contracts/errors';
import { CG_REGISTRY } from '@cg/contracts/errors/registry';
import { I18N_KEYS, isPluralKey, messageParams } from '@cg/contracts/i18n/catalog';
import { LOCALES, PLURAL_CATEGORIES, UI_PLURAL_KEYS, type Locale } from '@cg/contracts/i18n/keys';

import { CATALOGS, createTranslator, EN, interpolate, resolveLocale, RU } from './index';

type Message = string | Readonly<Record<string, string>>;
const asEntries = (catalog: object): Array<[string, Message]> => Object.entries(catalog) as Array<[string, Message]>;
const textsOf = (message: Message): string[] => (typeof message === 'string' ? [message] : Object.values(message));

/** Every text of a catalog with the key it belongs to. */
function allTexts(locale: Locale): Array<[string, string]> {
  return asEntries(CATALOGS[locale]).flatMap(([key, message]) => textsOf(message).map((text): [string, string] => [key, text]));
}

/**
 * AU-019: a chatter knows a login, a password and the devices they are signed
 * in on, nothing else. JS has no `\b` for Cyrillic, so a letter look-behind
 * keeps «выключено» from reading as «ключ».
 */
const FORBIDDEN_WORDS: ReadonlyArray<readonly [string, RegExp]> = [
  ['token', /(?<!\p{L})tokens?(?!\p{L})/iu],
  ['токен', /(?<!\p{L})токен/iu],
  ['key', /(?<!\p{L})keys?(?!\p{L})/iu],
  ['ключ', /(?<!\p{L})ключ/iu],
  ['API', /(?<!\p{L})api(?!\p{L})/iu],
  ['bearer', /(?<!\p{L})bearer/iu],
];

/** I18-002: product terms are written in Latin; these Cyrillic spellings must not appear. */
const CYRILLIC_TERMS: ReadonlyArray<readonly [string, RegExp]> = [
  ['Reply', /(?<!\p{L})реплай/iu],
  ['Fix', /(?<!\p{L})фикс(?!\p{L})/iu],
  ['Ping', /(?<!\p{L})пинг/iu],
  ['Review', /(?<!\p{L})ревью/iu],
  ['Recap', /(?<!\p{L})рекап/iu],
  ['Coach', /(?<!\p{L})коуч/iu],
  ['Split', /(?<!\p{L})сплит/iu],
  ['Spenders', /(?<!\p{L})спендер/iu],
  ['ChatSpace', /(?<!\p{L})чат ?спейс/iu],
  ['ChatGoose', /(?<!\p{L})чат ?гус/iu],
  ['OnlyMonster', /(?<!\p{L})онли ?монстр/iu],
  ['OnlyFans', /(?<!\p{L})онли ?фанс/iu],
  ['Mimic', /(?<!\p{L})мимик/iu],
];

describe('i18n catalogs: keys', () => {
  it('ru and en carry exactly the keys of the contract catalog', () => {
    const expected = [...I18N_KEYS].sort();
    expect(Object.keys(RU).sort()).toEqual(expected);
    expect(Object.keys(EN).sort()).toEqual(expected);
  });

  it('a plural key holds plural forms and nothing else does', () => {
    for (const locale of LOCALES) {
      for (const [key, message] of asEntries(CATALOGS[locale])) {
        expect(typeof message === 'object', `${locale} ${key}`).toBe(isPluralKey(key as never));
      }
    }
  });

  it('every message has text', () => {
    for (const locale of LOCALES) for (const [key, text] of allTexts(locale)) expect(text.trim(), `${locale} ${key}`).not.toBe('');
  });

  it('ru and en use the same parameters in every message', () => {
    for (const [key, ruMessage] of asEntries(RU)) {
      const enMessage = (EN as unknown as Record<string, Message>)[key] ?? '';
      const paramsOf = (message: Message) => new Set(textsOf(message).flatMap(messageParams));
      expect([...paramsOf(enMessage)].sort(), key).toEqual([...paramsOf(ruMessage)].sort());
    }
  });
});

describe('i18n catalogs: CG registry texts', () => {
  it('every code has a title and a body in both languages, with no parameters', () => {
    for (const code of CG_CODES) {
      const { title, body } = CG_REGISTRY[code];
      for (const locale of LOCALES) {
        const catalog = CATALOGS[locale];
        for (const text of [catalog[title], catalog[body]]) {
          expect(text, `${locale} ${code}`).toBeTruthy();
          expect(messageParams(text), `${locale} ${code}: the wire carries no parameters`).toEqual([]);
        }
      }
    }
  });
});

describe('i18n catalogs: plural rules (Intl.PluralRules)', () => {
  it('each plural message has exactly the categories of its locale', () => {
    for (const locale of LOCALES) {
      const categories = [...new Intl.PluralRules(locale).resolvedOptions().pluralCategories].sort();
      expect([...PLURAL_CATEGORIES[locale]].sort()).toEqual(categories);
      for (const key of UI_PLURAL_KEYS) {
        const forms = CATALOGS[locale][key] as Readonly<Record<string, string>>;
        expect(Object.keys(forms).sort(), `${locale} ${key}`).toEqual(categories);
        for (const form of Object.values(forms)) expect(messageParams(form), `${locale} ${key}`).toContain('n');
      }
    }
  });

  it('chooses Russian forms by the number', () => {
    const t = createTranslator('ru');
    const parts = [1, 2, 5, 11, 21, 22, 25, 101, 112].map((n) => t.plural('result.meta.parts', n));
    expect(parts).toEqual(['1 часть', '2 части', '5 частей', '11 частей', '21 часть', '22 части', '25 частей', '101 часть', '112 частей']);
    expect(t.plural('result.meta.parts', 1.5)).toBe('1.5 части');
    expect(t.plural('settings.status.needActions', 3)).toBe('Нужно 3 действия');
    expect(t.plural('spenders.footer', 21, { loaded: 20, coverage: 'охват полный' })).toBe('20 из 21 фана, охват полный');
  });

  it('chooses English forms by the number', () => {
    const t = createTranslator('en');
    expect([0, 1, 2].map((n) => t.plural('common.messages', n))).toEqual(['0 messages', '1 message', '2 messages']);
  });
});

describe('i18n catalogs: vocabulary', () => {
  it('no token / key / API / bearer words in any UI text (AU-019)', () => {
    for (const locale of LOCALES) {
      for (const [key, text] of allTexts(locale)) {
        const found = FORBIDDEN_WORDS.filter(([, pattern]) => pattern.test(text)).map(([word]) => word);
        expect(found, `${locale} ${key}: «${text}»`).toEqual([]);
      }
    }
  });

  it('the vocabulary check itself catches the words and spares look-alikes', () => {
    const hits = (text: string) => FORBIDDEN_WORDS.some(([, pattern]) => pattern.test(text));
    for (const bad of ['Ключ устройства', 'API недоступен', 'token expired', 'Bearer x', 'paste your key', 'токен']) expect(hits(bad), bad).toBe(true);
    for (const fine of ['выключено', 'включён', 'переключить', 'Hotkeys', 'Keyboard', 'keystroke']) expect(hits(fine), fine).toBe(false);
  });

  it('product terms stay in Latin (I18-002)', () => {
    for (const [key, text] of allTexts('ru')) {
      const found = CYRILLIC_TERMS.filter(([, pattern]) => pattern.test(text)).map(([term]) => term);
      expect(found, `ru ${key}: «${text}»`).toEqual([]);
    }
    for (const action of ['reply', 'fix', 'hi', 'ping', 'review', 'recap', 'coach'] as const) {
      expect(RU[`dock.action.${action}`]).toBe(EN[`dock.action.${action}`]);
    }
    for (const key of ['spenders.title', 'dock.option.split', 'coach.title', 'fanPanel.tab.recap'] as const) expect(RU[key]).toBe(EN[key]);
  });
});

describe('translator', () => {
  it('resolves `system` from the browser languages, defaulting to ru', () => {
    expect(resolveLocale('en', ['ru-RU'])).toBe('en');
    expect(resolveLocale('system', ['ru-RU', 'en-US'])).toBe('ru');
    expect(resolveLocale('system', ['en_GB'])).toBe('en');
    expect(resolveLocale('system', ['de-DE', 'en-US'])).toBe('en');
    expect(resolveLocale('system', ['uk-UA'])).toBe('ru');
    expect(resolveLocale('system', [])).toBe('ru');
  });

  it('interpolates parameters and keeps unknown placeholders visible', () => {
    expect(interpolate('{a} и {b}', { a: 1 })).toBe('1 и {b}');
    const t = createTranslator('ru');
    expect(t.text('common.errorSource', { code: 'CG-NETWORK' })).toBe('ChatGoose · CG-NETWORK');
    expect(t.text(CG_REGISTRY['CG-QUOTA-DAILY'].title)).toBe('Дневная квота AI исчерпана');
    expect(createTranslator('en').text('popup.btn.keys')).toBe('Shortcuts');
  });
});
