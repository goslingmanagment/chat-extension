// A fan the page does not see (2026-11-12; contracts fan-account.ts): one word in place of his @handle — «удалён»,
// «заблокировал» (on OnlyFans «в блоке»), «не виден» — and a card on hover that says why and when it was checked. The
// same words in Spenders, «Рассылка» and Fansly's chat header; each site's own through its catalog (the shared one has
// OnlyFans' words, Fansly lays its own over them). A mark: it disables nothing. «Заблокировал» is the noticeable one
// (the kit's warning ink, kept on a muted row); the other two are quiet.

import { type JSX } from 'preact';

import { type FanGone } from '@cg/contracts/fan-account';
import { type I18n } from '@cg/contracts/vm';

import { useI18n } from '../context';
import { useTooltip } from './Tooltip';

const LABEL = { deleted: 'spenders.tag.deleted', blocked: 'spenders.tag.blocked', unchecked: 'spenders.tag.unchecked' } as const;
const HINT = { deleted: 'spenders.gone.deletedHint', blocked: 'spenders.gone.blockedHint', unchecked: 'spenders.gone.uncheckedHint' } as const;

/** «удалён», «заблокировал», «не виден» (the site's own words). */
export function fanGoneLabel(i18n: Pick<I18n, 't'>, gone: FanGone): string {
  return i18n.t(LABEL[gone.state]);
}

/** Why, since when the page does not see him (where the site says it and it is known), when it was checked. */
export function fanGoneHint(i18n: Pick<I18n, 't'>, gone: FanGone): string {
  const since = gone.since === null ? '' : ` ${i18n.t('spenders.gone.since', { date: { time: gone.since, style: 'date' } })}`;
  return i18n.t(HINT[gone.state], { since, checked: { time: gone.checkedAt, style: 'datetime' } });
}

/** The word in place of the @handle, with its card on hover; `class` — the list's own class for a handle. */
export function FanGoneTag({ gone, class: extra }: { readonly gone: FanGone; readonly class?: string }): JSX.Element {
  const i18n = useI18n();
  const tip = useTooltip(fanGoneHint(i18n, gone));
  return (
    <span class={`cg-gone is-${gone.state}${extra === undefined ? '' : ` ${extra}`}`} data-cg-gone={gone.state} {...(gone.local ? { 'data-cg-gone-local': '' } : {})} {...tip.props}>
      {fanGoneLabel(i18n, gone)}
      {tip.description}
    </span>
  );
}

export const FAN_GONE_CSS = `
.cg-gone { color: var(--cg-ink-muted); }
.cg-gone.is-blocked { color: var(--cg-warn-ink); font-weight: 500; }
`;
