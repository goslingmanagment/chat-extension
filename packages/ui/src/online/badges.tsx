// A Fansly fan's badges beside the name in «Онлайн» (2026-10-28; contracts fan-badges.ts), drawn as FBuddy draws them so a
// chatter reads them at a glance: a gem in the tier's colour (Bronze, Silver, Gold, Platinum) with Fansly's blue card in
// its corner when the fan has it; the blue card alone when there is no tier (or Basic); Basic alone — a crossed
// banknote. The words are the tooltip's.

import { type JSX } from 'preact';

import { type FanBadges } from '@cg/contracts/fan-badges';

import { Icon, useI18n, useTooltip } from '../kit';

/** What the pill shows: the gem of a tier, the blue card, or Basic; null — nothing to show. */
export function badgeLook(badges: FanBadges | null | undefined): { readonly kind: 'gem' | 'card' | 'basic'; readonly corner: boolean } | null {
  if (badges === null || badges === undefined) return null;
  const recent = badges.recentSpender === true;
  if (badges.tier !== null && badges.tier !== 'basic') return { kind: 'gem', corner: recent };
  if (recent) return { kind: 'card', corner: false };
  return badges.tier === 'basic' ? { kind: 'basic', corner: false } : null;
}

export function FanBadge({ badges }: { readonly badges: FanBadges | null | undefined }): JSX.Element | null {
  const i18n = useI18n();
  const look = badgeLook(badges);
  const words =
    look === null || badges === null || badges === undefined
      ? null
      : [badges.tier === null ? null : i18n.t(`online.badge.tier.${badges.tier}`), badges.recentSpender === true ? i18n.t('online.badge.recent') : null].filter((part): part is string => part !== null).join(' · ');
  const tip = useTooltip(words);
  if (look === null || badges === null || badges === undefined) return null;
  const tone = look.kind === 'gem' ? (badges.tier ?? 'basic') : look.kind === 'card' ? 'blue' : 'basic';
  return (
    <span class={`ol-badge is-${tone}`} role="img" aria-label={words ?? ''} data-cg-badge={tone} {...(look.corner ? { 'data-cg-badge-card': '1' } : {})} {...tip.props}>
      <Icon name={look.kind === 'gem' ? 'gem' : look.kind === 'card' ? 'card' : 'noMoney'} size={14} />
      {look.corner ? <Icon name="card" size={12} class="ol-badge__card" /> : null}
      {tip.description}
    </span>
  );
}
