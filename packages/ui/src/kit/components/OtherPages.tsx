// What a fan spends on other pages of the agency (hub `otherPagesSpend`): a green coin beside the name, among the fan's
// badges and in their shape, so a chatter does not greet him as a cold follower. The tooltip names the pages and the
// sums, the biggest first. An attribute of a fan, never a warning.

import { type JSX } from 'preact';

import { type I18n, type OtherPageSpendVM } from '@cg/contracts/vm';

import { useI18n } from '../context';
import { Icon } from './Icon';
import { useTooltip } from './Tooltip';

/** One page: «lora-2 $1,653». */
export const otherPagesLine = (i18n: Pick<I18n, 'formatMoneyMills'>, page: OtherPageSpendVM): string => `${page.pageLabel} ${i18n.formatMoneyMills(page.grossMills)}`;

export function OtherPagesMark({ pages }: { readonly pages: readonly OtherPageSpendVM[] | undefined }): JSX.Element | null {
  const i18n = useI18n();
  const shown = pages ?? [];
  const title = i18n.t('otherPages.title');
  const tip = useTooltip(shown.length === 0 ? null : [title, ...shown.map((page) => otherPagesLine(i18n, page))].join('\n'));
  if (shown.length === 0) return null;
  return (
    <span class="cg-fbadge is-other" role="img" aria-label={title} data-cg-other-pages={String(shown.length)} {...tip.props}>
      <Icon name="coin" size={14} />
      {tip.description}
    </span>
  );
}

export const OTHER_PAGES_CSS = `
.cg-fbadge.is-other { --cg-fbadge-ink: var(--cg-good-ink); --cg-fbadge-line: var(--cg-good-line); --cg-fbadge-bg: var(--cg-good-bg); }
`;
