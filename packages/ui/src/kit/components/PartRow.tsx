// The base of a result part (ui-design §3.2, §4.3, §6.4; UI-019…UI-027): a
// draft card — a dashed frame, a warm fill, the text in the serif AI-authored
// text is set in — with its number, a quiet Copy icon and «Вставить» on every
// part (the next part's is the main one and carries ↵), a spinner while
// inserting, an inline error card when inserting or copying failed. An
// inserted part keeps its whole text, a step dimmer, with «✓ Вставлено ·
// Вставить ещё раз» beside it (the old card); a sent one is one collapsed line.
// The whole row is the target (UI-018, X26): a click anywhere on it but its
// own controls does what the row's main button does — «Вставить» THIS part,
// «Вставить ещё раз» on an inserted one, «Копировать» where nothing can be
// inserted; a click that ends a text selection is the selection's, and a sent
// part has nothing to click. Enter on the focused part inserts THIS part
// (never a collapsed one: «Вставить ещё раз» is a click of its own; with
// «Вставить» unavailable Enter says why; a held Enter counts once);
// ⌘C / Ctrl+C — the physical C key, so the Russian layout works too —
// copies it when nothing inside is selected. A part whose copy is closed
// (a Coach draft in Cyrillic, AI-087) copies by no way of these: its copy
// buttons are off with the reason, ⌘C and the row say it. Surfaces put
// their rows (the X8 send row, the Б2 question) in `children`.

import { type ComponentChildren, type JSX, type Ref, type TargetedKeyboardEvent, type TargetedMouseEvent } from 'preact';

import { type PartVM } from '@cg/contracts/vm';

import { useAnnounce, useHints, useI18n, useKit } from '../context';
import { isComposing, isHeldKey } from '../focus';
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
  /** false — only the row's buttons, Enter and ⌘C act; a click on the text selects it, nothing else (Coach). */
  readonly rowClick?: boolean;
}

/** What a click inside the row belongs to instead of the row: a control, the error card, the surface's own rows. */
const ROW_OWN = 'button, a, input, textarea, select, [role="button"], .cg-part__card, .cg-part__extra';

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
  const announce = useAnnounce();
  const { part, mode } = props;
  const n = part.index + 1;
  const sentAt = part.send?.s === 'sent' ? part.send.at : null;
  // A sent part is always the one collapsed line: nothing on it can put the text back into a composer.
  const collapsed = part.collapsed || sentAt !== null;
  // An inserted part reads whole (the old card); only a sent one folds to a line, its text in the tooltip.
  const kept = collapsed && sentAt === null;
  const fullText = useTooltip(collapsed && !kept ? part.text : null);
  const copyLabel = part.copy === 'done' ? i18n.t('common.copied') : i18n.t('part.copyN', { n });
  const insertKey = props.insertKey ?? '↵';

  const canAgain = collapsed && props.onInsertAgain !== undefined && sentAt === null && mode === 'insert';
  const copyBlocked = part.copyBlocked === null ? null : i18n.text(part.copyBlocked.text);
  /** «Копировать», or why it is off. */
  const copy = (): void => {
    if (copyBlocked !== null) announce(copyBlocked);
    else props.onCopy(part);
  };
  /** The main action of an open part: «Вставить», or «Копировать» where nothing can be inserted; unavailable — it says why. */
  const act = (): void => {
    if (mode === 'copy-only') copy();
    else if (part.insertBlocked !== null) announce(i18n.text(part.insertBlocked.text));
    else if (part.insert !== 'pending') props.onInsert(part);
  };

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>): void => {
    props.onKeyDown?.(event);
    if (event.defaultPrevented || event.target !== event.currentTarget || isComposing(event)) return;
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      // A held Enter is one press: its repeats insert nothing more.
      if (isHeldKey(event)) return;
      // Inserted or sent: inserting again is only ever the explicit «Вставить ещё раз» (UI-022).
      if (collapsed) return;
      act();
      return;
    }
    // The physical key (architecture.md §9.1): Ctrl+С on ЙЦУКЕН is `с`, still KeyC.
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.code === 'KeyC') {
      if (hasSelectionInside(root, event.currentTarget)) return;
      event.preventDefault();
      copy();
    }
  };

  const rowClick = props.rowClick !== false;
  const onClick = (event: TargetedMouseEvent<HTMLDivElement>): void => {
    // While the Б2 question stands in the part, only its three buttons answer.
    if (!rowClick || event.defaultPrevented || event.button !== 0 || props.confirming === true) return;
    // A control of the row, its error card and the surface's rows (the Б2 question) answer their own clicks.
    if (event.target instanceof Element && event.target.closest(ROW_OWN) !== null) return;
    // The click that ends a drag over the text selected it; it asks for nothing more.
    if (hasSelectionInside(root, event.currentTarget)) return;
    if (!collapsed) act();
    else if (canAgain && part.insert !== 'pending') props.onInsertAgain?.(part);
  };

  // «Копировать» in words, as the old card's button, where the row has room; the icon alone on a narrow one.
  const copyIcon = (
    <Button
      label={part.copy === 'done' ? i18n.t('common.copied') : i18n.t('common.copy')}
      icon={part.copy === 'done' ? 'check' : 'copy'}
      variant="quiet"
      class="cg-part__copy"
      tooltip={copyLabel}
      reason={copyBlocked}
      onClick={() => props.onCopy(part)}
    />
  );

  let main: JSX.Element | null = null;
  if (!collapsed) {
    if (mode === 'copy-only') {
      // «Копировать» takes the place of «Вставить» and of the quiet icon (final-7b): a line with ↵ on the next part.
      main = (
        <Button
          label={part.copy === 'done' ? i18n.t('common.copied') : i18n.t('common.copy')}
          icon={part.copy === 'done' ? 'check' : 'copy'}
          variant={part.next ? 'line' : 'quiet'}
          class="cg-copy-main"
          hotkey={part.next ? insertKey : null}
          reason={copyBlocked}
          onClick={() => props.onCopy(part)}
        />
      );
    } else {
      const blocked = part.insertBlocked === null ? null : i18n.text(part.insertBlocked.text);
      main = (
        <Button
          label={i18n.t('part.insert')}
          variant="line"
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

  const classes = [
    'cg-part',
    part.next && !collapsed ? 'is-next' : '',
    part.numbered ? '' : 'is-solo',
    collapsed ? 'is-done' : '',
    canAgain ? 'can-again' : '',
    rowClick && (!collapsed || canAgain) && props.confirming !== true ? 'is-click' : '',
    kept ? 'is-kept' : '',
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
      onClick={onClick}
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
            {mode === 'copy-only' ? null : copyIcon}
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
.cg-parts { display: grid; gap: 6px; padding: 8px; }
.cg-part {
  display: grid; grid-template-columns: calc(var(--cg-gutter) - 1px) minmax(0, 1fr) auto; align-items: start;
  padding: 7px 7px 7px 0; border: 1px dashed var(--cg-clay-line); border-radius: 9px; background: var(--cg-draft);
  transition: background-color 120ms var(--cg-ease), border-color 120ms var(--cg-ease);
}
.cg-part.is-solo { grid-template-columns: 11px minmax(0, 1fr) auto; }
.cg-part.is-click { cursor: pointer; }
.cg-part__card, .cg-part__extra { cursor: auto; }
.cg-part.is-click:hover, .cg-part:focus-within, .cg-part.is-confirm { background: var(--cg-draft-hover); border-color: var(--cg-clay-ink); }
.cg-part:focus-visible { border-radius: 9px; }
${/* The number's line is the AI text's own: at «Крупнее» (24 px lines) a 21 px one held it 3 px above the text's baseline. */ ''}
.cg-part__n { text-align: center; font-family: var(--cg-mono); font-size: var(--cg-text-xs); line-height: var(--cg-leading-ai); font-weight: 600; color: var(--cg-ink-muted); font-variant-numeric: tabular-nums; }
.cg-part.is-next .cg-part__n { color: var(--cg-clay-ink); }
.cg-part__t { font-family: var(--cg-serif); font-size: var(--cg-text-ai); line-height: var(--cg-leading-ai); color: var(--cg-ink); white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; }
.cg-part__a { display: flex; align-items: center; gap: 4px; margin: -3px 0 -3px 10px; }
.cg-part .cg-ins, .cg-part .cg-copy-main { background: var(--cg-raised); }
.cg-part.is-next .cg-ins:not([aria-disabled="true"]), .cg-part.is-next .cg-copy-main:not([aria-disabled="true"]) { background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); color: var(--cg-clay-ink); }
.cg-part.is-next .cg-ins:not([aria-disabled="true"]):hover, .cg-part.is-next .cg-copy-main:not([aria-disabled="true"]):hover { box-shadow: inset 0 0 0 1px var(--cg-clay-ink); }
.cg-part .cg-ins[aria-disabled="true"], .cg-part .cg-copy-main[aria-disabled="true"] { background: none; }
.cg-part.is-done { padding-top: 3px; padding-bottom: 3px; align-items: center; border-style: solid; border-color: var(--cg-rule); background: none; }
.cg-part.is-done.is-click:hover, .cg-part.is-done:focus-within { background: var(--cg-sunk); border-color: var(--cg-rule-3); }
.cg-part.is-done .cg-part__t { color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: var(--cg-text-md); }
.cg-part.is-done .cg-part__a { margin-top: -1px; margin-bottom: -1px; }
.cg-part.is-done.is-kept { padding-top: 7px; padding-bottom: 7px; align-items: start; border-style: dashed; border-color: var(--cg-rule-3); }
.cg-part.is-done.is-kept .cg-part__t { color: var(--cg-ink-2); white-space: pre-wrap; overflow: visible; font-size: var(--cg-text-ai); }
.cg-part.is-done.is-kept .cg-part__again { display: inline-flex; }
.cg-part.is-done.is-kept .cg-part__state { display: inline-flex; }
.cg-part.is-done.is-kept .cg-part__a { margin: -3px 0 -3px 10px; }
.cg-part__copy { color: var(--cg-ink-2); }
.cg-part.is-kept .cg-part__copy { width: 28px; padding: 0; justify-content: center; }
.cg-part.is-kept .cg-part__copy .cg-btn__t { display: none; }
@container cg (max-width: 599px) {
  .cg-part__copy { width: 28px; padding: 0; justify-content: center; }
  .cg-part__copy .cg-btn__t { display: none; }
}
.cg-part__state { display: inline-flex; align-items: center; gap: 5px; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); padding: 0 6px; white-space: nowrap; }
.cg-part__again { display: none; }
.cg-part.is-done:hover .cg-part__again, .cg-part.is-done:focus-within .cg-part__again { display: inline-flex; }
/* A kept part shows «вставлено» and «Вставить ещё раз» side by side: hiding the mark on hover would widen its text, rewrap it and make the card jump. */
.cg-part.can-again:not(.is-kept):hover .cg-part__state, .cg-part.can-again:not(.is-kept):focus-within .cg-part__state { display: none; }
.cg-part__card { grid-column: 2 / 4; margin-top: 8px; min-width: 0; }
.cg-part__card .cg-card__text { font-size: var(--cg-text-base); }
.cg-part__extra { grid-column: 2 / 4; min-width: 0; }
@container cg (max-width: 420px) {
  .cg-part { grid-template-columns: 26px minmax(0, 1fr) auto; }
  .cg-part__a { display: contents; }
  .cg-part__a > .cg-part__copy { grid-column: 3; grid-row: 1; margin: -3px 0 -3px 4px; }
  .cg-part__a > .cg-ins, .cg-part__a > .cg-copy-main { grid-column: 2; grid-row: 2; justify-self: start; margin: 6px 0 0; }
  .cg-part.is-done .cg-part__a { display: flex; grid-column: 3; margin: -1px 0 -1px 6px; }
}
@media (prefers-reduced-motion: reduce) { .cg-part { transition: none; } }
`;
