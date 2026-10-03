// The base of a result part (ui-design §3.2, §4.3, §6.4; UI-019…UI-027):
// the number in the gutter, the text, a quiet Copy icon that is always
// there, «Вставить ↵» on the next part (on the others it shows on hover and
// focus), a spinner while inserting, an inline error card when inserting or
// copying failed, and one collapsed line once a part is inserted or sent.
// Clicking the text inserts nothing; Enter on the focused part inserts THIS
// part; ⌘C / Ctrl+C copies it when nothing inside is selected. Surfaces put
// their rows (the X8 send row, the Б2 question) in `children`. An ancestor
// with the class `cg-bare` («Вид ответа: без подложки», §3.2) switches the
// rules and the hover to the bare tokens.

import { type ComponentChildren, type JSX, type Ref, type TargetedKeyboardEvent } from 'preact';

import { type PartVM } from '@cg/contracts/vm';

import { useHints, useI18n, useKit } from '../context';
import { isComposing } from '../focus';
import { dark } from '../tokens';
import { Button } from './Button';
import { ErrorCard } from './ErrorCard';
import { Icon } from './Icon';
import { useTooltip } from './Tooltip';

export interface PartRowProps {
  readonly part: PartVM;
  /** `copy-only`: «Копировать» takes the place of «Вставить» (UI-027). */
  readonly mode: 'insert' | 'copy-only';
  readonly onInsert: (part: PartVM) => void;
  readonly onCopy: (part: PartVM) => void;
  /** «Вставить ещё раз» on the collapsed line of an inserted part (UI-022). */
  readonly onInsertAgain?: (part: PartVM) => void;
  /** «One tab stop» parts: the next part is 0, the others -1 (ui-design §6.3). */
  readonly tabIndex?: 0 | -1;
  /** ↑ ↓ between parts belong to the list that owns the parts. */
  readonly onKeyDown?: (event: TargetedKeyboardEvent<HTMLDivElement>) => void;
  /** The key label of «Вставить» on the next part. */
  readonly insertKey?: string;
  /** The Б2 question is open inside this part: the sunk background. */
  readonly confirming?: boolean;
  readonly partRef?: Ref<HTMLDivElement>;
  /** Extra rows under the text (columns 2–3): the send row, the Б2 question. */
  readonly children?: ComponentChildren;
}

function hasSelectionInside(root: ShadowRoot | Document, element: HTMLElement): boolean {
  const selection = 'getSelection' in root && typeof root.getSelection === 'function' ? root.getSelection() : element.ownerDocument.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return false;
  const anchor = selection.anchorNode;
  return anchor !== null && element.contains(anchor);
}

export function PartRow(props: PartRowProps): JSX.Element {
  const i18n = useI18n();
  const hints = useHints();
  const { root } = useKit();
  const { part, mode } = props;
  const n = part.index + 1;
  const sentAt = part.send?.s === 'sent' ? part.send.at : null;
  const collapsed = part.collapsed;
  const fullText = useTooltip(collapsed ? part.text : null);
  const copyLabel = part.copy === 'done' ? i18n.t('common.copied') : i18n.t('part.copyN', { n });
  const insertKey = props.insertKey ?? '↵';

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>): void => {
    props.onKeyDown?.(event);
    if (event.defaultPrevented || event.target !== event.currentTarget || isComposing(event)) return;
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      if (mode === 'copy-only' || part.insertBlocked !== null) props.onCopy(part);
      else if (part.insert !== 'pending') props.onInsert(part);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'c') {
      if (hasSelectionInside(root, event.currentTarget)) return;
      event.preventDefault();
      props.onCopy(part);
    }
  };

  const copyIcon = (
    <Button label={copyLabel} icon={part.copy === 'done' ? 'check' : 'copy'} iconOnly variant="quiet" class="cg-part__copy" onClick={() => props.onCopy(part)} />
  );

  let main: JSX.Element | null = null;
  if (!collapsed) {
    if (mode === 'copy-only') {
      main = (
        <Button
          label={i18n.t('common.copy')}
          icon="copy"
          variant={part.next ? 'line' : 'plain'}
          class="cg-copy-main"
          hotkey={part.next ? insertKey : null}
          onClick={() => props.onCopy(part)}
        />
      );
    } else {
      const blocked = part.insertBlocked === null ? null : i18n.text(part.insertBlocked.text);
      main = (
        <Button
          label={i18n.t('part.insert')}
          variant={part.next ? 'line' : 'plain'}
          class="cg-ins"
          hotkey={part.next ? insertKey : null}
          busy={part.insert === 'pending'}
          reason={blocked}
          tooltip={hints ? i18n.t('part.insertTooltip') : null}
          onClick={() => props.onInsert(part)}
        />
      );
    }
  }

  const canAgain = collapsed && props.onInsertAgain !== undefined && sentAt === null && mode === 'insert';
  const classes = [
    'cg-part',
    part.next && !collapsed ? 'is-next' : '',
    collapsed ? 'is-done' : '',
    canAgain ? 'can-again' : '',
    props.confirming === true ? 'is-confirm' : '',
  ]
    .filter((name) => name !== '')
    .join(' ');
  const label = sentAt === null ? i18n.text(part.label) : i18n.t('part.ariaSent', { n });

  return (
    <div
      ref={props.partRef ?? null}
      class={classes}
      role="group"
      aria-label={label}
      tabIndex={props.tabIndex ?? -1}
      data-cg-part={part.index}
      {...(part.variant === null ? {} : { 'data-cg-variant': part.variant })}
      onKeyDown={onKeyDown}
    >
      <span class="cg-part__n" aria-hidden="true">
        {part.numbered ? n : ''}
      </span>
      <span class="cg-part__t" {...fullText.props}>
        {part.text}
      </span>
      {fullText.description}
      <span class="cg-part__a">
        {collapsed ? (
          <>
            <span class="cg-part__state">
              <Icon name="check" size={13} />
              {sentAt === null ? i18n.t('part.inserted') : i18n.t('send.sent', { time: { time: sentAt } })}
            </span>
            {canAgain ? (
              <Button label={i18n.t('part.insertAgain')} variant="plain" class="cg-part__again" onClick={() => props.onInsertAgain?.(part)} />
            ) : null}
            {copyIcon}
          </>
        ) : (
          <>
            {copyIcon}
            {main}
          </>
        )}
      </span>
      {!collapsed && part.insert === 'failed' && part.insertError !== null ? (
        <div class="cg-part__card">
          <ErrorCard error={part.insertError} tone="failure" inline />
        </div>
      ) : null}
      {!collapsed && part.copy === 'failed' && part.copyError !== null ? (
        <div class="cg-part__card">
          <ErrorCard error={part.copyError} tone="failure" inline copyCode={false} />
        </div>
      ) : null}
      {props.children === undefined ? null : <div class="cg-part__extra">{props.children}</div>}
    </div>
  );
}

export const PART_CSS = `
.cg-part {
  display: grid; grid-template-columns: calc(var(--cg-gutter) - 1px) minmax(0, 1fr) auto; align-items: start;
  padding: 9px 6px 9px 0; border-top: 1px solid var(--cg-rule); transition: background-color 120ms var(--cg-ease);
}
.cg-part:first-child { border-top: 0; }
.cg-part:hover, .cg-part:focus-within, .cg-part.is-confirm { background: var(--cg-sunk); }
.cg-part:focus-visible { outline: none; border-radius: 0; box-shadow: inset 2px 0 0 var(--cg-focus); background: var(--cg-sunk); }
.cg-part__n { text-align: center; font-size: var(--cg-text-sm); line-height: 20px; color: var(--cg-ink-muted); font-variant-numeric: tabular-nums; }
.cg-part__t { font-size: var(--cg-text-lg); line-height: 20px; color: var(--cg-ink); white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; }
.cg-part__a { display: flex; align-items: center; gap: 2px; margin: -3px 0 -3px 12px; }
.cg-part .cg-ins { visibility: hidden; }
.cg-part.is-next .cg-ins, .cg-part:hover .cg-ins, .cg-part:focus-within .cg-ins { visibility: visible; }
.cg-part:not(.is-next) .cg-ins { box-shadow: none; color: var(--cg-ink-2); }
.cg-part:not(.is-next) .cg-ins[aria-disabled="true"] { color: var(--cg-ink-faint); }
.cg-part.is-done { padding-top: 5px; padding-bottom: 5px; align-items: center; }
.cg-part.is-done .cg-part__t { color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: var(--cg-text-base); }
.cg-part.is-done .cg-part__a { margin-top: -4px; margin-bottom: -4px; }
.cg-part__state { display: inline-flex; align-items: center; gap: 5px; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); padding: 0 6px; white-space: nowrap; }
.cg-part__again { display: none; }
.cg-part.is-done:hover .cg-part__again, .cg-part.is-done:focus-within .cg-part__again { display: inline-flex; }
.cg-part.can-again:hover .cg-part__state, .cg-part.can-again:focus-within .cg-part__state { display: none; }
.cg-part__card { grid-column: 2 / 4; margin-top: 8px; min-width: 0; }
.cg-part__card .cg-card__text { font-size: var(--cg-text-base); }
.cg-part__extra { grid-column: 2 / 4; min-width: 0; }
.cg-bare .cg-part { border-color: var(--cg-bare-rule); }
.cg-bare .cg-part:hover, .cg-bare .cg-part:focus-within, .cg-bare .cg-part.is-confirm, .cg-bare .cg-part:focus-visible { background: var(--cg-bare-hover); }
.cg-bare .cg-btn--line { background: var(--cg-surface); }
.cg-bare .cg-btn--line[aria-disabled="true"], .cg-bare .cg-part:not(.is-next) .cg-ins { background: none; }
${dark('.cg-bare .cg-btn--line[aria-disabled="true"]')} { background: none; }
@container cg (max-width: 420px) {
  .cg-part { grid-template-columns: 28px minmax(0, 1fr) auto; }
  .cg-part__a { display: contents; }
  .cg-part__a > .cg-part__copy { grid-column: 3; grid-row: 1; margin: -3px 0 -3px 4px; }
  .cg-part__a > .cg-ins, .cg-part__a > .cg-copy-main { grid-column: 2; grid-row: 2; justify-self: start; margin: 6px 0 0 -8px; }
  .cg-part:not(.is-next):not(:hover):not(:focus-within):not(.is-done):not(.is-confirm) .cg-ins { display: none; }
  .cg-part.is-done .cg-part__a { display: flex; grid-column: 3; margin: -4px 0 -4px 6px; }
}
@media (prefers-reduced-motion: reduce) { .cg-part { transition: none; } }
`;
