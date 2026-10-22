// The head of a result sheet (ui-design §4.2): the gutter (a spinner while
// streaming), the function's name and whom it is for («Reply — @fan», as the
// old Fansly extension's head), then meta with the cost line last, and on the
// right «Ещё раз», ↗ «Развернуть» and × «Скрыть»; their keys are in their
// hints, not printed in the head (X57). Narrow rules are CSS: meta hides at 420 px,
// «Ещё раз» becomes ↻ below 360 px so that the draft label always fits whole
// (§3.3, §9.5 п. 4); below 360 px the buttons of a Recap or Review head take a
// second line.

import { type ComponentChildren, type JSX } from 'preact';

import { type HotkeyLabel, type UiAction } from '@cg/contracts/vm';

import { Button, hotkeyText, useDispatch, useI18n, useKit, useTooltip } from '../kit';

export interface HeadProps {
  readonly title: string;
  /** Whom the answer is for: «Reply — @fan»; null or absent — not known, the title alone. */
  readonly fan?: string | null;
  /** The 35 px gutter: a spinner while a generation runs, empty otherwise. */
  readonly gutter?: ComponentChildren;
  /** After the title: a score, the stage line, a segment, meta, the draft label. */
  readonly children?: ComponentChildren;
  /** The right side. */
  readonly acts?: ComponentChildren;
  /**
   * A head with tools of its own after the title (Recap's segment, Review's
   * score) and up to four buttons on the right: below 360 px the buttons take
   * a second line instead of running out of the dock (ui-design §3.3, §6.5).
   */
  readonly tools?: boolean;
}

/** « — @fan» after the title: cut with «…» where the head is short, the whole name in its hint. */
function FanName({ name }: { readonly name: string }): JSX.Element {
  const tip = useTooltip(name);
  return (
    <>
      <span class="cg-head__fan" {...tip.props}>
        — {name}
      </span>
      {tip.description}
    </>
  );
}

export function Head({ title, fan, gutter, children, acts, tools = false }: HeadProps): JSX.Element {
  return (
    <header class={tools ? 'cg-head cg-head--tools' : 'cg-head'}>
      <span class="cg-gut">{gutter}</span>
      <span class="cg-head__title">{title}</span>
      {fan === null || fan === undefined || fan === '' ? null : <FanName name={fan} />}
      {children}
      <span class="cg-head__sp" />
      <span class="cg-head__acts">{acts}</span>
    </header>
  );
}

/** What the answer cost, the last quiet word of the head; in/write/read/out in its hint (the old head's spend line). */
function Usage({ usage }: { readonly usage: { readonly line: string; readonly detail: string } }): JSX.Element {
  const tip = useTooltip(usage.detail);
  return (
    <>
      <span class="cg-head__meta cg-head__usage cg-num" {...tip.props}>
        {usage.line}
      </span>
      {tip.description}
    </>
  );
}

export function Meta({ texts, usage = null }: { readonly texts: readonly string[]; readonly usage?: { readonly line: string; readonly detail: string } | null }): JSX.Element {
  return (
    <>
      {texts.map((text, index) => (
        <span key={index} class="cg-head__meta">
          {text}
        </span>
      ))}
      {usage === null ? null : <Usage usage={usage} />}
    </>
  );
}

/** ↗ «Развернуть» (UI-014): the result in its window, without the sheet's height limit — on every result, as the old head had it. */
export function ExpandButton({ opId }: { readonly opId: string }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  return <Button label={i18n.t('result.expand')} icon="expand" iconOnly variant="quiet" class="cg-expand" onClick={() => void dispatch({ type: 'ExpandResult', operationId: opId, expanded: true })} />;
}

export interface AgainButtonProps {
  readonly hotkey: HotkeyLabel | null;
  /** Why a new generation cannot start now (`canRegenerate = false`). */
  readonly reason: string | null;
  readonly onClick: () => void;
  readonly label?: string;
  readonly tooltip?: string;
}

/** «Ещё раз» (⌘E in its hint): a new generation with the original's tone (AI-007). */
export function AgainButton(props: AgainButtonProps): JSX.Element {
  const i18n = useI18n();
  const key = hotkeyText(props.hotkey)?.display;
  const tooltip = props.tooltip ?? i18n.t('result.againTooltip');
  return (
    <Button
      label={props.label ?? i18n.t('common.again')}
      icon="refresh"
      class="cg-again"
      hotkey={props.hotkey}
      tooltip={key === undefined ? tooltip : `${tooltip}  ${key}`}
      reason={props.reason}
      onClick={props.onClick}
    />
  );
}

/** × «Скрыть» (Esc): collapses the sheet and keeps the result (AI-128). */
export function HideButton({ onClick }: { readonly onClick: () => void }): JSX.Element {
  const i18n = useI18n();
  const { deps } = useKit();
  return (
    <Button
      label={i18n.t('common.hide')}
      icon="x"
      variant="quiet"
      class="cg-hide"
      hotkey={deps.catalog.entry('close').hotkey ?? i18n.t('common.key.esc')}
      tooltip={i18n.t('result.hideTooltip')}
      onClick={onClick}
    />
  );
}

/** «Отменить» (⌘. in its hint): stops the generation the head shows. */
export function CancelButton({ action }: { readonly action: UiAction }): JSX.Element {
  const i18n = useI18n();
  const { deps } = useKit();
  const dispatch = useDispatch();
  const hotkey = deps.catalog.entry('cancel').hotkey;
  const key = hotkeyText(hotkey)?.display;
  const tooltip = i18n.t('cheatsheet.row.cancel');
  return <Button label={i18n.t('common.cancelOp')} class="cg-cancel" hotkey={hotkey} tooltip={key === undefined ? tooltip : `${tooltip}  ${key}`} onClick={() => void dispatch(action)} />;
}
