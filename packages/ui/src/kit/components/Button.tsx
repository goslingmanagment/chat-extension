// Buttons (ui-design §4.0, §4.1): plain, line (a raised chip), quiet, send
// («Отправить» only), small and icon sizes; the chip of the dock's bar and of
// the preview's mini strip, whose key is a cap at its corner shown on hover
// and on keyboard focus (UI-006). Unavailable is never `disabled`: it is `aria-disabled="true"`,
// keeps focus, drops its key label and explains itself in the tooltip and
// through `aria-describedby` (ui-design §4, §6.1). A busy button shows a
// spinner and does nothing on a click. A held Enter clicks once.

import { type ComponentChildren, type JSX, type Ref, type TargetedKeyboardEvent, type TargetedMouseEvent } from 'preact';

import { type ActionButtonVM, type HotkeyLabel } from '@cg/contracts/vm';

import { useDispatch, useHints, useI18n, useOffClick } from '../context';
import { swallowHeldEnter } from '../focus';
import { dark } from '../tokens';
import { Icon, type IconName } from './Icon';
import { ReadyBadge, Spinner } from './Indicators';
import { useTooltip } from './Tooltip';

export type ButtonVariant = 'plain' | 'line' | 'quiet' | 'send';
/** Roles a <button> may take in our surfaces (menus, tabs, list options, switches). */
export type ButtonRole = 'menuitem' | 'menuitemradio' | 'tab' | 'option' | 'switch' | 'checkbox';

/** What a key label prints and announces; a key the browser keeps is never shown as working (§9.1). */
export function hotkeyText(hotkey: HotkeyLabel | string | null | undefined): { readonly display: string; readonly aria: string } | null {
  if (hotkey === null || hotkey === undefined) return null;
  if (typeof hotkey === 'string') return hotkey === '' ? null : { display: hotkey, aria: '' };
  if (hotkey.delivery === 'reserved') return hotkey.fallback === null ? null : { display: hotkey.fallback.display, aria: hotkey.fallback.aria };
  const aria = hotkey.fallback === null ? hotkey.aria : `${hotkey.aria} ${hotkey.fallback.aria}`;
  return { display: hotkey.display, aria };
}

export function Kbd({ children }: { readonly children: ComponentChildren }): JSX.Element {
  return <kbd>{children}</kbd>;
}

export interface ButtonProps {
  /** The visible text; with `iconOnly` the accessible name. */
  readonly label: string;
  readonly variant?: ButtonVariant;
  readonly size?: 'md' | 'sm';
  readonly icon?: IconName;
  readonly iconOnly?: boolean;
  /** Printed after the text in a <kbd> and set as `aria-keyshortcuts`. */
  readonly hotkey?: HotkeyLabel | string | null;
  /** Description shown when `ui.hints` is on. */
  readonly tooltip?: string | null;
  /** Unavailable: dimmed, `aria-disabled`, no key label, the reason in the tooltip (always). */
  readonly reason?: string | null;
  /** In progress: dimmed like unavailable, a spinner instead of the key, `aria-busy`, clicks ignored. */
  readonly busy?: boolean;
  readonly pressed?: boolean;
  readonly expanded?: boolean;
  readonly haspopup?: 'menu' | 'dialog' | 'listbox';
  readonly onClick?: (event: TargetedMouseEvent<HTMLButtonElement>) => void;
  readonly onKeyDown?: (event: TargetedKeyboardEvent<HTMLButtonElement>) => void;
  readonly class?: string;
  readonly buttonRef?: Ref<HTMLButtonElement>;
  readonly tabIndex?: number;
  readonly id?: string;
  readonly role?: ButtonRole;
  /** After the text (a chevron, a counter). */
  readonly trailing?: ComponentChildren;
}

export function Button(props: ButtonProps): JSX.Element {
  const hints = useHints();
  const offClick = useOffClick();
  const variant = props.variant ?? 'plain';
  const unavailable = props.reason !== null && props.reason !== undefined && props.reason !== '';
  const busy = props.busy === true;
  const keys = hotkeyText(props.hotkey);
  const tooltipText = unavailable ? (props.reason ?? null) : hints ? (props.tooltip ?? (props.iconOnly === true ? props.label : null)) : props.iconOnly === true ? props.label : null;
  const tip = useTooltip(tooltipText);
  const classes = [
    'cg-btn',
    `cg-btn--${variant}`,
    props.size === 'sm' ? 'cg-btn--sm' : '',
    props.iconOnly === true ? 'cg-btn--icon' : '',
    props.class ?? '',
  ]
    .filter((name) => name !== '')
    .join(' ');
  return (
    <>
      <button
        type="button"
        ref={props.buttonRef ?? null}
        class={classes}
        {...tip.props}
        {...(props.id === undefined ? {} : { id: props.id })}
        {...(props.role === undefined ? {} : { role: props.role })}
        {...(props.tabIndex === undefined ? {} : { tabIndex: props.tabIndex })}
        {...(props.iconOnly === true ? { 'aria-label': props.label } : {})}
        {...(unavailable || busy ? { 'aria-disabled': 'true' } : {})}
        {...(busy ? { 'aria-busy': 'true' } : {})}
        {...(props.pressed === undefined ? {} : { 'aria-pressed': props.pressed ? 'true' : 'false' })}
        {...(props.expanded === undefined ? {} : { 'aria-expanded': props.expanded ? 'true' : 'false' })}
        {...(props.haspopup === undefined ? {} : { 'aria-haspopup': props.haspopup })}
        {...(keys !== null && keys.aria !== '' && !unavailable ? { 'aria-keyshortcuts': keys.aria } : {})}
        onClick={(event) => {
          if (unavailable || busy) {
            event.preventDefault();
            if (unavailable) offClick(props.label, props.reason ?? '');
            return;
          }
          props.onClick?.(event);
        }}
        onKeyDown={(event) => {
          swallowHeldEnter(event);
          tip.props.onKeyDown(event);
          props.onKeyDown?.(event);
        }}
      >
        {props.icon === undefined ? null : <Icon name={props.icon} size={props.size === 'sm' ? 14 : 16} />}
        {props.iconOnly === true ? null : <span class="cg-btn__t">{props.label}</span>}
        {busy ? <Spinner /> : keys === null || unavailable || props.iconOnly === true ? null : <Kbd>{keys.display}</Kbd>}
        {props.trailing}
      </button>
      {tip.description}
    </>
  );
}

/** A button the controller already decided (ActionButtonVM): its label, availability, reason and key. */
export function ActionButton({
  vm,
  variant,
  size,
  icon,
  class: extra,
}: {
  readonly vm: ActionButtonVM;
  readonly variant?: ButtonVariant;
  readonly size?: 'md' | 'sm';
  readonly icon?: IconName;
  readonly class?: string;
}): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  return (
    <Button
      label={i18n.text(vm.label)}
      variant={variant ?? 'plain'}
      size={size ?? 'md'}
      hotkey={vm.hotkey}
      reason={vm.enabled ? null : vm.reason === null ? i18n.t('common.unknown') : i18n.text(vm.reason.text)}
      onClick={() => void dispatch(vm.action)}
      {...(icon === undefined ? {} : { icon })}
      {...(extra === undefined ? {} : { class: extra })}
    />
  );
}

export interface StripButtonProps {
  readonly label: string;
  readonly hotkey?: HotkeyLabel | string | null;
  /** Its result is open: the chip is tinted and ringed with the accent. */
  readonly active?: boolean;
  /** Its generation runs: a spinner over the dimmed label, the width as it was (UI-007). */
  readonly busy?: boolean;
  readonly reason?: string | null;
  readonly tooltip?: string | null;
  /** The 6 px «Recap готов» point. */
  readonly ready?: boolean;
  /** Whose point it is (the closed list of the accent's uses): Recap's by default, Voice's «Войс готов». */
  readonly readyUse?: 'recap-ready' | 'voice-ready';
  readonly pressed?: boolean;
  readonly expanded?: boolean;
  readonly haspopup?: 'menu';
  readonly onClick?: () => void;
  readonly onKeyDown?: (event: TargetedKeyboardEvent<HTMLButtonElement>) => void;
  readonly tabIndex?: number;
  readonly buttonRef?: Ref<HTMLButtonElement>;
  /** Before the text: the Split check glyph, the icon a narrow bar shows instead of the word. */
  readonly leading?: ComponentChildren;
  /** A narrow bar may show the chip as its icon alone: then its hint keeps the name even with the hints off. */
  readonly iconable?: boolean;
  /** After the text: a lock, a value. */
  readonly trailing?: ComponentChildren;
  readonly class?: string;
}

/** A chip of the dock's bar (ui-design §4.1): 28 px, 13 / 600, raised; the key is a cap at its corner. */
export function StripButton(props: StripButtonProps): JSX.Element {
  const hints = useHints();
  const offClick = useOffClick();
  const unavailable = props.reason !== null && props.reason !== undefined && props.reason !== '';
  const keys = hotkeyText(props.hotkey);
  const tip = useTooltip(unavailable ? (props.reason ?? null) : hints ? (props.tooltip ?? null) : props.iconable === true ? props.label : null);
  const classes = ['cg-act', props.active === true ? 'is-active' : '', props.busy === true ? 'is-busy' : '', props.class ?? '']
    .filter((name) => name !== '')
    .join(' ');
  return (
    <>
      <button
        type="button"
        ref={props.buttonRef ?? null}
        class={classes}
        {...tip.props}
        {...(props.tabIndex === undefined ? {} : { tabIndex: props.tabIndex })}
        {...(unavailable ? { 'aria-disabled': 'true' } : {})}
        {...(props.busy === true ? { 'aria-busy': 'true' } : {})}
        {...(props.pressed === undefined ? {} : { 'aria-pressed': props.pressed ? 'true' : 'false' })}
        {...(props.expanded === undefined ? {} : { 'aria-expanded': props.expanded ? 'true' : 'false' })}
        {...(props.haspopup === undefined ? {} : { 'aria-haspopup': props.haspopup })}
        {...(keys !== null && keys.aria !== '' && !unavailable ? { 'aria-keyshortcuts': keys.aria } : {})}
        onClick={(event) => {
          if (unavailable) {
            event.preventDefault();
            offClick(props.label, props.reason ?? '');
            return;
          }
          props.onClick?.();
        }}
        onKeyDown={(event) => {
          swallowHeldEnter(event);
          tip.props.onKeyDown(event);
          props.onKeyDown?.(event);
        }}
      >
        {props.leading}
        <span class="cg-act__t">{props.label}</span>
        {props.trailing}
        {keys === null || unavailable ? null : <Kbd>{keys.display}</Kbd>}
        {props.ready === true ? <ReadyBadge {...(props.readyUse === undefined ? {} : { use: props.readyUse })} /> : null}
      </button>
      {tip.description}
    </>
  );
}

/** The 1 × 16 px seam between the groups of a bar. */
export function Divider(): JSX.Element {
  return <span class="cg-div" aria-hidden="true" />;
}

/** Text kept for screen readers while its chip shows a glyph only. */
const VISUALLY_HIDDEN = 'position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap;';

/**
 * The capsule of Reply's options (the Fansly extension's bar, decision X28): a sunken groove pressed against Reply,
 * in the dock's bar and in a preview's mini strip. A tone is an emoji cell — the chosen one rises out of the groove
 * as a thumb and keeps its place, so nothing in the bar moves when a tone is chosen; Split, behind a hairline seam,
 * is pressed INTO the groove while on. Two physics in one capsule keep a checkbox from reading as a fifth tone.
 * Explained here, not in the sheet: a comment in the sheet ships with it.
 */
const CAPSULE_CSS = `.cg-tones { display: inline-flex; align-items: center; flex: none; height: 28px; padding: 0 3px; border-radius: var(--cg-r-pill); background: var(--cg-groove); box-shadow: inset 0 0 0 1px var(--cg-rule-2), inset 0 1px 2px rgb(0 0 0 / 0.08); }
.cg-tones__track { display: inline-flex; align-items: center; gap: 1px; }
.cg-tones__seam { width: 1px; height: 14px; flex: none; margin: 0 3px; background: var(--cg-rule-3); }
.cg-tones .cg-opt { height: 22px; border-radius: var(--cg-r-pill); background: none; box-shadow: none; }
.cg-tones .cg-tone { width: 26px; padding: 0; font-size: 14px; line-height: 1; filter: grayscale(0.35); opacity: 0.8; }
.cg-tone .cg-act__t { ${VISUALLY_HIDDEN} }
.cg-tones .cg-tone:hover { filter: none; opacity: 1; }
.cg-tones .cg-tone[aria-pressed="true"] { background: var(--cg-raised); box-shadow: inset 0 0 0 1px var(--cg-clay-line), 0 1px 2px rgb(0 0 0 / 0.12); filter: none; opacity: 1; }
.cg-tones .cg-tone[aria-disabled="true"] { filter: grayscale(1); opacity: 0.3; }
.cg-tones .cg-tone[aria-disabled="true"][aria-pressed="true"] { filter: none; opacity: 0.85; }
.cg-tones :is(.cg-split, .cg-recap-tick) { padding: 0 8px 0 6px; font-size: var(--cg-text-sm); color: var(--cg-ink-2); }
.cg-tones :is(.cg-split, .cg-recap-tick):hover { color: var(--cg-ink-strong); }
.cg-tones :is(.cg-split, .cg-recap-tick)[aria-pressed="true"] { background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line), inset 0 1px 3px rgb(0 0 0 / 0.16); color: var(--cg-clay-ink); }
.cg-tones :is(.cg-split, .cg-recap-tick)[aria-disabled="true"] { color: var(--cg-ink-faint); }
.cg-lock { margin: 0 4px 0 1px; color: var(--cg-ink-faint); }`;

export const BUTTON_CSS = `
.cg-btn {
  display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 8px; flex: none;
  border-radius: 7px; font-size: var(--cg-text-base); line-height: 18px; font-weight: 500;
  color: var(--cg-ink-2); white-space: nowrap; position: relative;
  transition: background-color 120ms var(--cg-ease), color 120ms var(--cg-ease), box-shadow 120ms var(--cg-ease);
}
.cg-btn:hover { background: var(--cg-hover); color: var(--cg-ink-strong); }
.cg-btn:active { background: var(--cg-press); }
.cg-btn[aria-expanded="true"] { background: var(--cg-hover); color: var(--cg-ink-strong); }
.cg-btn--line { background: var(--cg-chip); box-shadow: inset 0 0 0 1px var(--cg-rule-2); color: var(--cg-ink-strong); }
.cg-btn--line:hover, .cg-btn--line[aria-expanded="true"] { background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); color: var(--cg-clay-ink); }
.cg-btn--line:active { background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-ink); }
.cg-btn--quiet { color: var(--cg-ink-muted); font-weight: 400; }
.cg-btn--send { background: var(--cg-send); color: var(--cg-send-ink); padding: 0 10px; }
.cg-btn--send:hover { background: var(--cg-send-hover); color: var(--cg-send-ink); }
.cg-btn--send kbd { color: var(--cg-send-kbd); }
.cg-btn--sm { height: 22px; padding: 0 6px; font-size: var(--cg-text-sm); border-radius: var(--cg-r-sm); }
.cg-btn--sm::before { content: ""; position: absolute; inset: -1px 0; }
.cg-btn--icon { width: 26px; padding: 0; justify-content: center; }
.cg-btn--sm.cg-btn--icon { width: 22px; }
.cg-btn[aria-disabled="true"] { color: var(--cg-ink-faint); background: none; box-shadow: none; cursor: default; }
.cg-btn--line[aria-disabled="true"], .cg-btn--send[aria-disabled="true"] { box-shadow: inset 0 0 0 1px var(--cg-rule-2); }
.cg-btn[aria-disabled="true"] kbd { display: none; }
${dark('.cg-btn--line[aria-disabled="true"], .cg-btn--send[aria-disabled="true"]')} { box-shadow: inset 0 0 0 1px var(--cg-rule); }
.cg-btn .cg-spin { margin-left: 2px; }

.cg-act {
  position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 28px; padding: 0 9px; flex: none;
  border-radius: 7px; background: var(--cg-chip); box-shadow: inset 0 0 0 1px var(--cg-rule-2);
  color: var(--cg-ink); font-size: var(--cg-text-base); line-height: 18px; font-weight: 600; white-space: nowrap;
  transition: background-color 120ms var(--cg-ease), color 120ms var(--cg-ease), box-shadow 120ms var(--cg-ease);
}
.cg-act:hover, .cg-act[aria-expanded="true"] { background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); color: var(--cg-clay-ink); }
.cg-act:active { box-shadow: inset 0 0 0 1px var(--cg-clay-ink); }
.cg-act--main { background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); color: var(--cg-clay-ink); }
.cg-act--main:hover, .cg-act.is-active { background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-ink); color: var(--cg-clay-ink); }
.cg-act.is-busy .cg-act__t { opacity: 0.35; }
.cg-act.is-busy::after {
  content: ""; position: absolute; inset: 0; margin: auto; width: 11px; height: 11px; border-radius: 99px;
  border: 1.5px solid var(--cg-clay-line); border-top-color: var(--cg-clay); animation: cg-rot 0.9s linear infinite;
}
.cg-act[aria-disabled="true"] { color: var(--cg-ink-faint); background: none; box-shadow: inset 0 0 0 1px var(--cg-rule); cursor: default; }
.cg-act kbd {
  position: absolute; top: -6px; right: -3px; z-index: 1; padding: 0 4px; border-radius: 5px;
  background: var(--cg-raised); box-shadow: inset 0 0 0 1px var(--cg-rule-3), 0 1px 0 var(--cg-rule-3);
  color: var(--cg-ink-2); font-family: var(--cg-mono); font-size: var(--cg-text-kbd); line-height: 15px; font-weight: 500; letter-spacing: 0;
  pointer-events: none; opacity: 0; transform: translateY(2px) scale(0.94); transform-origin: bottom right;
  transition: opacity 120ms var(--cg-ease), transform 120ms var(--cg-ease);
}
.cg-act:hover kbd, .cg-act:focus-visible kbd { opacity: 1; transform: none; }
.cg-act[aria-disabled="true"] kbd { display: none; }
.cg-act:hover .cg-badge, .cg-act:focus-visible .cg-badge { opacity: 0; }
.cg-act .cg-ico { width: 12px; height: 12px; }
.cg-div { display: block; width: 1px; height: 16px; flex: none; margin: 0 3px; background: var(--cg-rule-3); opacity: 0.7; }
${CAPSULE_CSS}

@media (prefers-reduced-motion: reduce) {
  .cg-btn, .cg-act, .cg-act kbd { transition: none; }
  .cg-act.is-busy::after { animation: none; opacity: 0.6; }
}
`;
