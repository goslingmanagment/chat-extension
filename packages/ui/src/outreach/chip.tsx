// «Рассылка» folded («Свернуть», or a chat opened from it): a small chip in the page's corner — what the outreach sells
// and how far it got («отправлено 2 из 7 · +$25») — while the person answers in the chats. A click opens the window
// where it was. The chip sends nothing and covers nothing but itself.

import { type JSX } from 'preact';

import { Icon, OverlayLayer, useDispatch, useI18n, useView } from '../kit';
import { mediaShort } from './words';

export function OutreachChip({ place }: { readonly place: 'rail' | 'launcher' }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const vm = useView({ of: 'outreach' }).value;
  const chip = vm.chip;
  if (chip === null) return null;
  const progress =
    chip.total === 0
      ? i18n.t('outreach.chip.empty')
      : chip.sent + chip.ready === 0 && !vm.audience.locked
        ? i18n.plural('outreach.chip.notWritten', chip.total)
        : i18n.t('outreach.chip.sent', { n: chip.sent, total: chip.total });
  return (
    <OverlayLayer>
      <button type="button" class={`cg-ow-chip is-${place}`} aria-label={i18n.t('outreach.chip.open')} title={i18n.t('outreach.chip.open')} onClick={() => void dispatch({ type: 'SetOutreach', minimized: false })}>
        <span class="cg-ow-chip__icon" aria-hidden="true">
          <Icon name="mail" />
        </span>
        <span class="cg-ow-chip__text">
          <b>
            {i18n.t('outreach.title')}
            <span> · {mediaShort(i18n, chip.media)}</span>
          </b>
          <span class="cg-num">
            {progress}
            {chip.boughtMills === null ? null : (
              <>
                {' · '}
                <span class="cg-ow__money">{i18n.formatMoneyMills(chip.boughtMills, { sign: 'plus' })}</span>
              </>
            )}
          </span>
        </span>
        <Icon name="expand" size={14} class="cg-ow-chip__exp" />
      </button>
    </OverlayLayer>
  );
}
