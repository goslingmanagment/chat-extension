// What a fan spends on other pages of the agency (hub `otherPagesSpend`): the rest of the row's small print, so a chatter
// does not greet him as a cold follower. «@handle · не платил · lora-2 $1,653»; several pages: the biggest and «+N», the
// tooltip lists all. No plate and no colour of its own: one tone darker than the line, an attribute of a fan, never a
// warning. Whole: the row's own line gives way to it.

import { type JSX } from 'preact';

import { type I18n, type OtherPageSpendVM } from '@cg/contracts/vm';

import { useI18n } from '../context';
import { useTooltip } from './Tooltip';

type Money = Pick<I18n, 'formatMoneyMills'>;

/** One page: «lora-2 $1,653». */
export const otherPagesLine = (i18n: Money, page: OtherPageSpendVM): string => `${page.pageLabel} ${i18n.formatMoneyMills(page.grossMills)}`;

/** The mark's text: the biggest page, and «+N» for the rest. The list comes the biggest first. */
export function otherPagesLabel(i18n: Money, pages: readonly OtherPageSpendVM[]): string {
  const [top, ...rest] = pages;
  if (top === undefined) return '';
  return rest.length === 0 ? otherPagesLine(i18n, top) : `${otherPagesLine(i18n, top)} +${String(rest.length)}`;
}

export function OtherPagesMark({ pages }: { readonly pages: readonly OtherPageSpendVM[] | undefined }): JSX.Element | null {
  const i18n = useI18n();
  const shown = pages ?? [];
  const tip = useTooltip(shown.length === 0 ? null : [i18n.t('otherPages.title'), ...shown.map((page) => otherPagesLine(i18n, page))].join('\n'));
  if (shown.length === 0) return null;
  return (
    <span class="cg-other cg-num" data-cg-other-pages={String(shown.length)} {...tip.props}>
      {otherPagesLabel(i18n, shown)}
      {tip.description}
    </span>
  );
}

export const OTHER_PAGES_CSS = `
.cg-other { flex: none; max-width: 100%; margin-left: -4px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: var(--cg-text-sm); color: var(--cg-ink-2); }
.cg-other::before { content: '·'; margin-right: .35em; color: var(--cg-ink-muted); }
`;
