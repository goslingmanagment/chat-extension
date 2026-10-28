// A Fansly fan's badges beside the name (2026-10-28; contracts fan-badges.ts) in «Онлайн», Spenders, «Рассылка»,
// «Новые» and the fan's card, drawn as FBuddy draws them so a chatter reads them at a glance: a gem in the tier's colour
// (Bronze, Silver, Gold, Platinum) with Fansly's blue card in its corner when the fan has it; the blue card alone when there is no tier (or Basic); Basic alone — a crossed
// banknote. The words are the tooltip's.

import { type JSX } from 'preact';

import { type FanBadges } from '@cg/contracts/fan-badges';

import { useI18n } from '../context';
import { Icon } from './Icon';
import { useTooltip } from './Tooltip';

/** What the pill shows: the gem of a tier, the blue card, or Basic; null — nothing to show. */
export function badgeLook(badges: FanBadges | null | undefined): { readonly kind: 'gem' | 'card' | 'basic'; readonly corner: boolean } | null {
  if (badges === null || badges === undefined) return null;
  const recent = badges.recentSpender === true;
  if (badges.tier !== null && badges.tier !== 'basic') return { kind: 'gem', corner: recent };
  if (recent) return { kind: 'card', corner: false };
  return badges.tier === 'basic' ? { kind: 'basic', corner: false } : null;
}

/** `inline` — inside a line of text (a name's heading): a gap before it, on the text's middle. */
export function FanBadge({ badges, inline = false }: { readonly badges: FanBadges | null | undefined; readonly inline?: boolean }): JSX.Element | null {
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
    <span class={`cg-fbadge is-${tone}${inline ? ' is-inline' : ''}`} role="img" aria-label={words ?? ''} data-cg-badge={tone} {...(look.corner ? { 'data-cg-badge-card': '1' } : {})} {...tip.props}>
      <Icon name={look.kind === 'gem' ? 'gem' : look.kind === 'card' ? 'card' : 'noMoney'} size={14} />
      {look.corner ? <Icon name="card" size={12} class="cg-fbadge__card" /> : null}
      {tip.description}
    </span>
  );
}

export const FAN_BADGE_CSS = `
.cg-fbname { display: flex; align-items: center; gap: 6px; min-width: 0; }
.cg-fbname > :first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cg-fbadge {
  position: relative; flex: none; display: inline-flex; align-items: center; justify-content: center; height: 18px; padding: 0 5px;
  border-radius: 999px; border: 1px solid var(--cg-fbadge-line); background: var(--cg-fbadge-bg); color: var(--cg-fbadge-ink);
}
.cg-fbname.is-card .cg-fbadge { height: 20px; padding: 0 6px; }
.cg-fbadge.is-inline { margin-left: 6px; vertical-align: -3px; }
.cg-fbadge .cg-ico { stroke-width: 1.8; }
.cg-fbadge__card.cg-ico { position: absolute; right: -4px; bottom: -3px; width: 9px; height: 9px; padding: 1px; box-sizing: content-box; border-radius: 3px; background: var(--cg-surface); color: #0ea5e9; stroke-width: 2.2; }
.is-sel .cg-fbadge__card.cg-ico { background: var(--cg-sel); }
.cg-fbadge.is-bronze { --cg-fbadge-ink: #b8692a; --cg-fbadge-line: rgb(205 127 50 / .6); --cg-fbadge-bg: rgb(205 127 50 / .14); }
.cg-fbadge.is-silver { --cg-fbadge-ink: #5f6f86; --cg-fbadge-line: rgb(100 116 139 / .55); --cg-fbadge-bg: rgb(100 116 139 / .13); }
.cg-fbadge.is-gold { --cg-fbadge-ink: #b58900; --cg-fbadge-line: rgb(234 179 8 / .7); --cg-fbadge-bg: rgb(255 215 0 / .2); }
.cg-fbadge.is-platinum { --cg-fbadge-ink: #0891b2; --cg-fbadge-line: rgb(8 145 178 / .6); --cg-fbadge-bg: rgb(8 145 178 / .14); }
.cg-fbadge.is-blue { --cg-fbadge-ink: #0ea5e9; --cg-fbadge-line: rgb(14 165 233 / .6); --cg-fbadge-bg: rgb(14 165 233 / .13); }
.cg-fbadge.is-basic { --cg-fbadge-ink: #e05a72; --cg-fbadge-line: rgb(251 113 133 / .6); --cg-fbadge-bg: rgb(251 113 133 / .13); }
:host([data-scheme="dark"]) .cg-fbadge.is-silver { --cg-fbadge-ink: #cbd5e1; --cg-fbadge-line: rgb(203 213 225 / .5); }
:host([data-scheme="dark"]) .cg-fbadge.is-gold { --cg-fbadge-ink: #ffd700; }
:host([data-scheme="dark"]) .cg-fbadge.is-bronze { --cg-fbadge-ink: #d9934f; }
:host([data-scheme="dark"]) .cg-fbadge.is-platinum { --cg-fbadge-ink: #22d3ee; }
:host([data-scheme="dark"]) .cg-fbadge.is-blue, :host([data-scheme="dark"]) .cg-fbadge__card.cg-ico { color: #7dd3fc; }
:host([data-scheme="dark"]) .cg-fbadge.is-blue { --cg-fbadge-ink: #7dd3fc; }
`;
