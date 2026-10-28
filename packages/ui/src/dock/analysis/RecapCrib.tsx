// «Шпаргалка» (2026-10-28): the Recap window folded over the bar. Not the window's text cut to the sheet's height
// (the owner: «нихуя в него не помещается»), but what a chatter needs while typing: «Дальше» — the next move,
// «Не забыть» — what the model promised, «Не делать» — what to avoid. «Открыть Recap» unfolds the window out of it;
// × hides it. A build that runs is said in its head; the cheat sheet keeps the Recap it replaces until the new one is in.

import { type JSX } from 'preact';
import { useRef } from 'preact/hooks';

import { type RecapCribVM, type RecapViewVM } from '@cg/contracts/vm';

import { Button, ElapsedTimer, useAnchor, useDispatch, useI18n, useKit } from '../../kit';
import { RecapInline, Tile } from './RecapDoc';
import { MadeAgo, running } from './shared';

function Column({ tone, title, items }: { readonly tone: 'clay' | 'amber' | 'bad'; readonly title: string; readonly items: readonly string[] }): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <div class={`cg-rx-crib__c is-${tone}`}>
      <h4>{title}</h4>
      <ul>
        {items.map((item, index) => (
          <li key={index}>
            <RecapInline text={item} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** «из Recap, сделан 35 мин назад». */
function From({ at }: { readonly at: string }): JSX.Element {
  const i18n = useI18n();
  const [before = '', after = ''] = i18n.t('recap.crib.from', { made: '\u0000' }).split('\u0000');
  return (
    <>
      {before}
      <MadeAgo at={at} lower />
      {after}
    </>
  );
}

export function RecapCrib({ recap }: { readonly recap: RecapViewVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const { deps } = useKit();
  const box = useRef<HTMLElement>(null);
  // The window grows out of the cheat sheet when it unfolds.
  useAnchor('recap-crib', () => box.current);
  const building = running(recap.state);
  const madeAt = building ? (recap.kept?.generatedAt ?? null) : recap.generatedAt;
  const crib: RecapCribVM | null = recap.crib ?? null;
  const columns = crib === null ? 0 : [crib.next, crib.keep, crib.avoid].filter((items) => items.length > 0).length;
  const hide = (): void => {
    void dispatch({ type: 'ShowAnalysis', view: 'recap', mode: 'hidden' });
    deps.focus.restore();
  };
  return (
    <section ref={box} class="cg-rx-crib" aria-label={i18n.t(crib === null ? 'dock.action.recap' : 'recap.crib.title')}>
      <header class="cg-rx-crib__head">
        <Tile section={recap.length === 'full' ? 'strategy' : 'nextMove'} size={13} />
        <b class="cg-rx-crib__t">{i18n.t(crib === null ? 'dock.action.recap' : 'recap.crib.title')}</b>
        {building ? (
          <span class="cg-rx-crib__run" role="status">
            <span class="cg-rx-spin" aria-hidden="true" />
            {i18n.t(recap.length === 'short' ? 'recap.win.rebuildingShort' : 'recap.win.rebuilding')}
            {recap.phase === null ? null : (
              <b>
                <ElapsedTimer since={recap.phase.startedAt} />
              </b>
            )}
          </span>
        ) : madeAt === null ? null : (
          <span class="cg-rx-crib__sub">
            <From at={madeAt} />
          </span>
        )}
        <span class="cg-rx-crib__sp" />
        <Button label={i18n.t('recap.crib.open')} icon="expand" variant="quiet" size="sm" class="cg-rx-crib__open" tooltip={i18n.t('recap.crib.openTooltip')} onClick={() => void dispatch({ type: 'ShowAnalysis', view: 'recap', mode: 'expanded' })} />
        <Button label={i18n.t('recap.crib.hide')} icon="x" iconOnly variant="quiet" size="sm" class="cg-rx-crib__x" onClick={hide} />
      </header>
      {crib === null || columns === 0 ? null : (
        <div class={`cg-rx-crib__cols is-${String(columns)}`}>
          <Column tone="clay" title={i18n.t('recap.crib.next')} items={crib.next} />
          <Column tone="amber" title={i18n.t('recap.crib.keep')} items={crib.keep} />
          <Column tone="bad" title={i18n.t('recap.crib.avoid')} items={crib.avoid} />
        </div>
      )}
    </section>
  );
}
