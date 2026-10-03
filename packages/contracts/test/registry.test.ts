// The CG registry against Appendix A of docs/architecture.md: one entry per
// code in order, the «Повтор» column, the P1 marks, the text keys and the
// settings deep links.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import * as C from '../src/index';

interface AppendixRow {
  readonly code: string;
  readonly meaning: string;
  readonly retry: string;
}

function appendixARows(): AppendixRow[] {
  const doc = readFileSync(new URL('../../../docs/architecture.md', import.meta.url), 'utf8');
  const start = doc.indexOf('## Приложение А.');
  const end = doc.indexOf('**Чего в реестре нет:**', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return [...doc.slice(start, end).matchAll(/^\| (CG-[A-Z0-9-]+) \| (.+?) \| (\S+) \| .+ \|$/gm)].map((match) => ({
    code: match[1] ?? '',
    meaning: match[2] ?? '',
    retry: match[3] ?? '',
  }));
}

const entries = Object.values(C.CG_REGISTRY);

describe('CG registry (Appendix A, §5.7)', () => {
  it('has one entry per code, in Appendix A order', () => {
    expect(Object.keys(C.CG_REGISTRY)).toEqual([...C.CG_CODES]);
    for (const code of C.CG_CODES) expect(C.cgEntry(code).code).toBe(code);
  });

  it('follows the «Повтор» column', () => {
    const rows = appendixARows();
    expect(rows.map((row) => row.code)).toEqual([...C.CG_CODES]);
    expect(Object.keys(C.CG_RETRY_APPENDIX_A).sort()).toEqual([...C.CG_RETRIES].sort());
    for (const row of rows) {
      const entry = C.cgEntry(row.code as C.CgCode);
      expect(C.CG_RETRY_APPENDIX_A[entry.retry], row.code).toBe(row.retry);
    }
  });

  it('counts as P1 exactly the codes Appendix A marks «(P1)»', () => {
    const marked = appendixARows()
      .filter((row) => row.meaning.includes('(P1)'))
      .map((row) => row.code);
    expect(marked).toEqual(['CG-INSERT-MISPLACED']);
    expect([...C.CG_P1_CODES]).toEqual(marked);
  });

  it('derives the text keys from the code', () => {
    expect(C.cgTextBase('CG-HUB-HOST-PERMISSION')).toBe('hubHostPermission');
    expect(C.cgTitleKey('CG-QUOTA-DAILY')).toBe('cg.quotaDaily.title');
    expect(C.cgBodyKey('CG-UNKNOWN')).toBe('cg.unknown.body');
    for (const entry of entries) {
      expect(entry.title).toBe(C.cgTitleKey(entry.code));
      expect(entry.body).toBe(C.cgBodyKey(entry.code));
      expect(C.I18N_KEYS).toContain(entry.title);
      expect(C.I18N_KEYS).toContain(entry.body);
    }
  });

  it('uses only known vocabularies', () => {
    for (const entry of entries) {
      expect(C.CG_KINDS, entry.code).toContain(entry.kind);
      expect(C.CG_SEVERITIES, entry.code).toContain(entry.severity);
      expect(C.CG_RECOVERIES, entry.code).toContain(entry.recovery);
      expect(C.CG_RETRIES, entry.code).toContain(entry.retry);
      expect(C.CG_TELEMETRY_CLASSES, entry.code).toContain(entry.telemetry);
    }
  });

  it('deep-links into a settings section with its own code (§9.5, ST-007…ST-010)', () => {
    const linked = entries.filter((entry) => entry.settings !== undefined);
    expect(linked.length).toBeGreaterThan(0);
    for (const entry of linked) {
      expect(C.SettingsRouteSchema.safeParse(entry.settings).success, entry.code).toBe(true);
      expect(entry.settings?.code).toBe(entry.code);
    }
    expect(C.cgEntry('CG-PERSONA-UNASSIGNED').settings?.section).toBe('personas');
    expect(C.cgEntry('CG-AUTH-REQUIRED').settings?.section).toBe('account');
  });

  it('keeps the retry rule and the recovery consistent', () => {
    for (const entry of entries) {
      // A deadline is waited out, then retried by hand (ER-006).
      expect(entry.retry === 'after-deadline', entry.code).toBe(entry.recovery === 'wait-until');
      // «никогда»: no retry and no rerun is offered for an unknown or forbidden outcome.
      if (entry.retry === 'never') expect(['retry', 'new-generation'], entry.code).not.toContain(entry.recovery);
    }
    for (const code of C.CG_P1_CODES) expect(C.cgEntry(code).retry).toBe('never');
    expect(C.cgEntry('CG-SEND-UNCERTAIN').retry).toBe('never');
    expect(C.cgEntry('CG-INSERT-UNCERTAIN').retry).toBe('never');
  });

  it('has no retired code yet, and a retired entry would stay in place', () => {
    expect(C.CG_RETIRED_CODES).toEqual([]);
    for (const entry of entries) expect(entry.retired).toBeUndefined();
  });
});

describe('i18n key catalog', () => {
  it('lists every key once', () => {
    expect(new Set(C.I18N_KEYS).size).toBe(C.I18N_KEYS.length);
    expect(C.I18N_KEYS.length).toBe(C.UI_TEXT_KEYS.length + C.UI_PLURAL_KEYS.length + 2 * C.CG_CODES.length);
  });

  it('keeps UI keys apart from the derived CG title/body keys', () => {
    for (const key of [...C.UI_TEXT_KEYS, ...C.UI_PLURAL_KEYS]) expect(key, key).not.toMatch(/^cg\.[A-Za-z]+\.(title|body)$/);
    for (const key of C.I18N_KEYS) expect(key).toMatch(/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/);
  });

  it('knows the plural keys and the plural categories of each locale', () => {
    expect(C.isPluralKey('result.meta.parts')).toBe(true);
    expect(C.isPluralKey('common.copy')).toBe(false);
    for (const locale of C.LOCALES) {
      const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
      expect([...C.PLURAL_CATEGORIES[locale]].sort()).toEqual([...categories].sort());
    }
    expect(C.DEFAULT_LOCALE).toBe('ru');
  });

  it('reads message parameters', () => {
    expect(C.messageParams('{loaded} из {n} фанов, {coverage}')).toEqual(['loaded', 'n', 'coverage']);
    expect(C.messageParams('без параметров')).toEqual([]);
  });
});
