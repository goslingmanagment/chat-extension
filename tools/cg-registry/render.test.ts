import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { CG_CODES } from '../../packages/contracts/src/errors.ts';
import { CG_REGISTRY, CG_RETRY_APPENDIX_A } from '../../packages/contracts/src/errors/registry.ts';
import { RU } from '../../packages/core/src/domain/i18n/ru.ts';
import { REPO_ROOT } from '../lib/paths.ts';
import { REGISTRY_DOC_PATH, renderRegistryDoc } from './render.ts';

const render = (): string =>
  renderRegistryDoc({
    entries: Object.values(CG_REGISTRY),
    retryWord: (entry) => CG_RETRY_APPENDIX_A[entry.retry],
    ru: (key) => RU[key],
  });

describe('docs/error-registry.md', () => {
  it('is up to date with the registry and the ru catalog (node tools/cg-registry/generate.ts)', () => {
    expect(readFileSync(`${REPO_ROOT}${REGISTRY_DOC_PATH}`, 'utf8')).toBe(render());
  });

  it('has one row per code, in Appendix A order', () => {
    const codes = [...render().matchAll(/^\| (CG-[A-Z0-9-]+) \|/gm)].map((match) => match[1]);
    expect(codes).toEqual([...CG_CODES]);
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
