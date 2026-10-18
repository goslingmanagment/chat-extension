// The head of a result sheet (ui-design §4.2): the gutter (a spinner while
// streaming), the function's name, then meta, «черновик · не отправлено» and
// on the right «Ещё раз» and × «Скрыть»; their keys are in their hints, not
// printed in the head (X57). Narrow rules are CSS: meta hides at 600 px,
// «Ещё раз» becomes ↻ below 360 px so that the draft label always fits whole
// (§3.3, §9.5 п. 4); below 360 px the buttons of a Recap or Review head take a
// second line.

import { type ComponentChildren, type JSX } from 'preact';

import { type HotkeyLabel, type UiAction } from '@cg/contracts/vm';

import { Button, hotkeyText, useDispatch, useHints, useI18n, useKit, useTooltip } from '../kit';

export interface HeadProps {
  readonly title: string;
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

export function Head({ title, gutter, children, acts, tools = false }: HeadProps): JSX.Element {
  return (
    <header class={tools ? 'cg-head cg-head--tools' : 'cg-head'}>
      <span class="cg-gut">{gutter}</span>
      <span class="cg-head__title">{title}</span>
      {children}
      <span class="cg-head__sp" />
      <span class="cg-head__acts">{acts}</span>
    </header>
  );
}

export function Meta({ texts }: { readonly texts: readonly string[] }): JSX.Element {
  return (
    <>
      {texts.map((text, index) => (
        <span key={index} class="cg-head__meta">
          {text}
        </span>
      ))}
    </>
  );
}

/** «черновик · не отправлено»: on every draft until a part is sent, at every width (ui-design §1 п. 9). */
export function DraftLabel(): JSX.Element {
  const i18n = useI18n();
  const hints = useHints();
  const tip = useTooltip(hints ? i18n.t('result.draftTooltip') : null);
  return (
    <>
      <span class="cg-head__draft" data-cg-draft="" {...tip.props}>
        {i18n.t('result.draft')}
      </span>
      {tip.description}
    </>
  );
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
