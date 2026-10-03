// Buttons (ui-design §4.0, §4.1): plain, line, quiet, send («Отправить»
// only), small and icon sizes; the strip button of the dock and the preview's
// mini strip. Unavailable is never `disabled`: it is `aria-disabled="true"`,
// keeps focus, drops its key label and explains itself in the tooltip and
// through `aria-describedby` (ui-design §4, §6.1). A busy button shows a
// spinner and does nothing on a click.

import { type ComponentChildren, type JSX, type Ref, type TargetedKeyboardEvent, type TargetedMouseEvent } from 'preact';

import { type ActionButtonVM, type HotkeyLabel } from '@cg/contracts/vm';

import { useDispatch, useHints, useI18n } from '../context';
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
            return;
          }
          props.onClick?.(event);
        }}
        onKeyDown={(event) => {
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
  /** Its result is open: strong ink and a 1.5 px line under the text. */
  readonly active?: boolean;
  /** Its generation runs: the line runs (1.2 s cycle). */
  readonly busy?: boolean;
  readonly reason?: string | null;
  readonly tooltip?: string | null;
  /** The 6 px «Recap готов» point. */
  readonly ready?: boolean;
  readonly pressed?: boolean;
  readonly expanded?: boolean;
  readonly haspopup?: 'menu';
  readonly onClick?: () => void;
  readonly onKeyDown?: (event: TargetedKeyboardEvent<HTMLButtonElement>) => void;
  readonly tabIndex?: number;
  readonly buttonRef?: Ref<HTMLButtonElement>;
  /** Before the text: the Split check glyph. */
  readonly leading?: ComponentChildren;
  /** After the text: a lock, a value. */
  readonly trailing?: ComponentChildren;
  readonly class?: string;
}

/** A button of the dock strip (ui-design §4.1): 26 px, 13 / 500, the key label in 10.5 px. */
export function StripButton(props: StripButtonProps): JSX.Element {
  const hints = useHints();
  const unavailable = props.reason !== null && props.reason !== undefined && props.reason !== '';
  const keys = hotkeyText(props.hotkey);
  const tip = useTooltip(unavailable ? (props.reason ?? null) : hints ? (props.tooltip ?? null) : null);
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
            return;
          }
          props.onClick?.();
        }}
        onKeyDown={(event) => {
          tip.props.onKeyDown(event);
          props.onKeyDown?.(event);
        }}
      >
        {props.leading}
        <span class="cg-act__t">{props.label}</span>
        {props.trailing}
        {keys === null || unavailable ? null : <Kbd>{keys.display}</Kbd>}
        {props.ready === true ? <ReadyBadge /> : null}
      </button>
      {tip.description}
    </>
  );
}

/** The 1 × 12 px palisade between strip buttons. */
export function Divider(): JSX.Element {
  return <span class="cg-div" aria-hidden="true" />;
}

export const BUTTON_CSS = `
.cg-btn {
  display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 8px; flex: none;
  border-radius: var(--cg-r-sm); font-size: var(--cg-text-base); line-height: 18px; font-weight: 500;
  color: var(--cg-ink-2); white-space: nowrap; position: relative;
  transition: background-color 120ms var(--cg-ease), color 120ms var(--cg-ease), box-shadow 120ms var(--cg-ease);
}
.cg-btn:hover { background: var(--cg-hover); color: var(--cg-ink-strong); }
.cg-btn:active { background: var(--cg-press); }
.cg-btn[aria-expanded="true"] { background: var(--cg-hover); color: var(--cg-ink-strong); }
.cg-btn--line { box-shadow: inset 0 0 0 1px var(--cg-rule-3); color: var(--cg-ink-strong); }
.cg-btn--line:hover { box-shadow: inset 0 0 0 1px var(--cg-ink-muted); }
.cg-btn--quiet { color: var(--cg-ink-muted); font-weight: 400; }
.cg-btn--send { background: var(--cg-send); color: var(--cg-send-ink); padding: 0 10px; }
.cg-btn--send:hover { background: var(--cg-send-hover); color: var(--cg-send-ink); }
.cg-btn--send kbd { color: var(--cg-send-kbd); }
.cg-btn--sm { height: 22px; padding: 0 6px; font-size: var(--cg-text-sm); }
.cg-btn--sm::before { content: ""; position: absolute; inset: -1px 0; }
.cg-btn--icon { width: 26px; padding: 0; justify-content: center; }
.cg-btn--sm.cg-btn--icon { width: 22px; }
.cg-btn[aria-disabled="true"] { color: var(--cg-ink-faint); background: none; box-shadow: none; cursor: default; }
.cg-btn--line[aria-disabled="true"], .cg-btn--send[aria-disabled="true"] { box-shadow: inset 0 0 0 1px var(--cg-rule-2); }
.cg-btn[aria-disabled="true"] kbd { display: none; }
${dark('.cg-btn--line')} { box-shadow: inset 0 0 0 1px var(--cg-rule-2); }
${dark('.cg-btn--line:hover')} { box-shadow: inset 0 0 0 1px var(--cg-ink-muted); }
${dark('.cg-btn--line[aria-disabled="true"], .cg-btn--send[aria-disabled="true"]')} { box-shadow: inset 0 0 0 1px var(--cg-rule); }
.cg-btn .cg-spin { margin-left: 2px; }

.cg-act {
  position: relative; display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 7px; flex: none;
  border-radius: var(--cg-r-sm); color: var(--cg-ink-2); font-size: var(--cg-text-base); line-height: 18px; font-weight: 500; white-space: nowrap;
  transition: background-color 120ms var(--cg-ease), color 120ms var(--cg-ease);
}
.cg-act kbd { font-size: var(--cg-text-2xs); letter-spacing: 0; }
.cg-act:hover, .cg-act[aria-expanded="true"] { background: var(--cg-hover); color: var(--cg-ink-strong); }
.cg-act:active { background: var(--cg-press); }
.cg-act.is-active, .cg-act[aria-pressed="true"] { color: var(--cg-ink-strong); }
.cg-act.is-active::after, .cg-act.is-busy::after {
  content: ""; position: absolute; left: 7px; right: 7px; bottom: 1px; height: 1.5px; border-radius: 1px; background: currentColor;
}
.cg-act.is-busy::after { transform-origin: left center; animation: cg-busy 1.2s var(--cg-ease) infinite; }
@keyframes cg-busy { 0% { transform: scaleX(0.08); opacity: 1; } 60% { transform: scaleX(1); opacity: 1; } 100% { transform: scaleX(1); opacity: 0; } }
.cg-act[aria-disabled="true"] { color: var(--cg-ink-faint); background: none; cursor: default; }
.cg-act[aria-disabled="true"] kbd { display: none; }
.cg-act .cg-ico { width: 12px; height: 12px; }
.cg-div { display: block; width: 1px; height: 12px; flex: none; margin: 0 1px; background: var(--cg-divider); }

@media (prefers-reduced-motion: reduce) {
  .cg-btn, .cg-act { transition: none; }
  .cg-act.is-busy::after { animation: none; transform: none; opacity: 0.5; }
}
`;
