import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { CG_FANSLY_CODES, CG_FANSLY_REGISTRY } from '../../packages/contracts/src/errors-fansly.ts';
import { CG_CODES } from '../../packages/contracts/src/errors.ts';
import { CG_REGISTRY, CG_RETRY_APPENDIX_A } from '../../packages/contracts/src/errors/registry.ts';
import { FANSLY_CG_RU } from '../../packages/core/src/domain/hosts/fansly/i18n/ru.ts';
import { RU } from '../../packages/core/src/domain/i18n/ru.ts';
import { REPO_ROOT } from '../lib/paths.ts';
import { REGISTRY_DOC_PATH, renderRegistryDoc } from './render.ts';

const render = (): string =>
  renderRegistryDoc({
    entries: Object.values(CG_REGISTRY),
    retryWord: (entry) => CG_RETRY_APPENDIX_A[entry.retry],
    ru: (key) => RU[key],
    fansly: { entries: Object.values(CG_FANSLY_REGISTRY), ru: (key) => FANSLY_CG_RU[key] },
  });

describe('docs/error-registry.md', () => {
  it('is up to date with the registry and the ru catalog (node tools/cg-registry/generate.ts)', () => {
    expect(readFileSync(`${REPO_ROOT}${REGISTRY_DOC_PATH}`, 'utf8')).toBe(render());
  });

  it('has one row per code, in Appendix A order; the Fansly codes in their own section after the shared ones', () => {
    const doc = render();
    const fansly = doc.indexOf('## Коды Fansly');
    const rows = (text: string) => [...text.matchAll(/^\| (CG-[A-Z0-9-]+) \|/gm)].map((match) => match[1]);
    expect(rows(doc.slice(0, fansly))).toEqual([...CG_CODES]);
    expect(rows(doc.slice(fansly))).toEqual([...CG_FANSLY_CODES]);
    expect(doc).toContain(`Кодов: ${CG_FANSLY_CODES.length}.`);
  });

  it('shows the Russian texts, the retry word and the settings link', () => {
    const row = render()
      .split('\n')
      .find((line) => line.startsWith('| CG-QUOTA-DAILY |'));
    expect(row).toBe(
      '| CG-QUOTA-DAILY | quota | внимание | Дневная квота AI исчерпана | Квота обновится в 03:00 по Москве (00:00 UTC). | ждать срока | срок | счётчик | Статус (`#status:CG-QUOTA-DAILY`) |',
    );
  });
});
