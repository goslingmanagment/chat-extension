// A fan who is on other pages of the agency too (hub `otherPages`): where he paid or lately wrote himself. One mark, two
// circles that overlap, among the fan's badges and in their shape, so a chatter does not greet him as a cold follower. The
// tooltip tells each page: how much he paid, when he wrote, whether he subscribes. An attribute of a fan, never a warning.

import { type JSX } from 'preact';

import { type I18n, type OtherPageVM } from '@cg/contracts/vm';

import { useI18n } from '../context';
import { Icon } from './Icon';
import { useTooltip } from './Tooltip';

/** One page: «lora-2: $1,653 · писал 5 д назад · подписан». */
export function otherPagesLine(i18n: Pick<I18n, 't' | 'formatMoneyMills' | 'formatAge'>, page: OtherPageVM): string {
  const facts = [
    page.grossMills > 0 ? i18n.formatMoneyMills(page.grossMills) : i18n.t('online.row.notPaid'),
    page.lastFanMessageAt === null ? null : i18n.t('otherPages.wrote', { age: i18n.formatAge(page.lastFanMessageAt) }),
    page.relation === null ? null : i18n.t(page.relation === 'subscriber' ? 'otherPages.subscriber' : 'otherPages.follower'),
  ].filter((fact): fact is string => fact !== null);
  return `${page.pageLabel}: ${facts.join(' · ')}`;
}

export function OtherPagesMark({ pages }: { readonly pages: readonly OtherPageVM[] | undefined }): JSX.Element | null {
  const i18n = useI18n();
  const shown = pages ?? [];
  const title = i18n.t('otherPages.title');
  const tip = useTooltip(shown.length === 0 ? null : [title, ...shown.map((page) => otherPagesLine(i18n, page))].join('\n'));
  if (shown.length === 0) return null;
  return (
    <span class="cg-fbadge is-other" role="img" aria-label={title} data-cg-other-pages={String(shown.length)} {...tip.props}>
      <Icon name="overlap" size={14} />
      {tip.description}
    </span>
  );
}

export const OTHER_PAGES_CSS = `
:host { --cg-other-ink: #6a4fc0; }
:host([data-scheme="dark"]) { --cg-other-ink: #b6a4f0; }
.cg-fbadge.is-other { --cg-fbadge-ink: var(--cg-other-ink); --cg-fbadge-line: rgb(106 79 192 / .45); --cg-fbadge-bg: rgb(106 79 192 / .12); }
:host([data-scheme="dark"]) .cg-fbadge.is-other { --cg-fbadge-line: rgb(182 164 240 / .45); --cg-fbadge-bg: rgb(182 164 240 / .14); }
`;
