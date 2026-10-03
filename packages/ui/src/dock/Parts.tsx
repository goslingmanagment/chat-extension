// Parts of an answer (ui-design §4.3, §4.6, §6.3, §6.4; UI-018…UI-027,
// AI-011, AI-030): rows of the kit's PartRow, one at a time. «Вставить ↵»
// stands on the next part only; a click or Enter on a focused part inserts
// THAT part, never the next one by itself, and nothing is ever sent from
// here. Parts are one tab stop: ↑ ↓ move between them, ← → between the
// variants of Hi. The Б2 question («в поле уже есть ваш текст») opens inside
// the part being inserted, with focus on «Добавить в конец».

import { type JSX, type TargetedKeyboardEvent } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

import { type ConfirmVM, type PartVM, type VariantVM } from '@cg/contracts/vm';

import { Button, PartRow, activeIn, focusQuietly, useAnnounce, useDispatch, useI18n, useKit } from '../kit';

export interface PartsScope {
  readonly opId: string;
  /** `copy-only`: «Копировать» takes the place of «Вставить» (UI-027, UI-032). */
  readonly mode: 'insert' | 'copy-only';
  readonly confirm: ConfirmVM | null;
}

/** Insert, copy and «Вставить ещё раз» of the parts of one operation, with what the live region says. */
export function usePartActions(opId: string): {
  readonly insert: (part: PartVM) => void;
  readonly copy: (part: PartVM) => void;
  /** True from the person's own insert until its answer: a Б2 question it raises may take focus. */
  readonly asked: { current: boolean };
} {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const announce = useAnnounce();
  const asked = useRef(false);
  return {
    asked,
    insert: (part) => {
      // The question may arrive through the view before this receipt does.
      asked.current = true;
      void dispatch({ type: 'InsertPart', operationId: opId, ...(part.variant === null ? {} : { variant: part.variant }), part: part.index }).then((receipt) => {
        if (receipt?.ok === true && receipt.outcome === 'needs-confirm') return;
        asked.current = false;
        if (receipt?.ok === true && receipt.outcome === 'done') announce(i18n.t('part.inserted'));
      });
    },
    copy: (part) => {
      void dispatch({ type: 'Copy', artifactHandle: part.copyHandle }).then((receipt) => {
        if (receipt?.ok === true) announce(i18n.t('common.copied'));
      });
    },
  };
}

function confirms(confirm: ConfirmVM | null, part: PartVM): confirm is ConfirmVM {
  return confirm !== null && confirm.part.index === part.index && (confirm.part.variant ?? 0) === (part.variant ?? 0);
}

/** Б2: «Заменить», «Добавить в конец» (the default), «Отмена Esc» (ui-design §4.6). */
function ConfirmRow({ confirm, takeFocus }: { readonly confirm: ConfirmVM; readonly takeFocus: { current: boolean } }): JSX.Element {
  const i18n = useI18n();
  const { root, deps } = useKit();
  const dispatch = useDispatch();
  const box = useRef<HTMLDivElement>(null);
  const append = useRef<HTMLButtonElement>(null);
  // The question takes focus when the person's own action asked it: their insert, or focus already inside our root.
  useLayoutEffect(() => {
    if (takeFocus.current || activeIn(root) !== null) focusQuietly(append.current);
    takeFocus.current = false;
  }, [confirm.confirmationId]);
  const answer = (choice: 'replace' | 'append' | 'cancel'): void => {
    // «Отмена» gives focus back to «Вставить» of this part (ui-design §6.3); the row is gone once the answer lands.
    const part = box.current?.closest<HTMLElement>('.cg-part') ?? null;
    void dispatch({ type: 'AnswerConfirm', confirmationId: confirm.confirmationId, choice });
    if (choice === 'cancel') focusQuietly(part?.querySelector<HTMLElement>('.cg-ins') ?? part);
  };
  const question = i18n.t(confirm.kind === 'draft-changed' ? 'confirm.draftChanged' : 'confirm.humanDraft');
  return (
    <div
      ref={box}
      class={`cg-confirm${confirm.formatLoss ? ' is-long' : ''}`}
      role="group"
      aria-label={question}
      data-cg-confirm={confirm.kind}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        answer('cancel');
      }}
    >
      <span class="cg-confirm__q">
        {question}
        {confirm.formatLoss ? <span class="cg-confirm__loss"> {i18n.t('confirm.formatLoss')}</span> : null}
      </span>
      <Button label={i18n.t('confirm.replace')} variant="line" onClick={() => answer('replace')} />
      <Button label={i18n.t('confirm.append')} variant="line" buttonRef={append} onClick={() => answer('append')} />
      <Button label={i18n.t('common.cancel')} variant="quiet" hotkey={deps.catalog.entry('close').hotkey ?? i18n.t('common.key.esc')} onClick={() => answer('cancel')} />
    </div>
  );
}

/** ↑ ↓ between the parts of a list, ← → to the same part of the neighbouring variant (ui-design §6.4). */
function movePartFocus(event: TargetedKeyboardEvent<HTMLDivElement>): void {
  if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const here = event.currentTarget;
  const list = here.closest<HTMLElement>('[data-cg-parts]');
  if (list === null) return;
  let next: HTMLElement | undefined;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const all = [...list.querySelectorAll<HTMLElement>('.cg-part')];
    next = all[all.indexOf(here) + (event.key === 'ArrowDown' ? 1 : -1)];
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    const variant = Number(here.getAttribute('data-cg-variant') ?? Number.NaN);
    if (Number.isNaN(variant)) return;
    const column = [...list.querySelectorAll<HTMLElement>(`.cg-part[data-cg-variant="${variant + (event.key === 'ArrowRight' ? 1 : -1)}"]`)];
    next = column.find((part) => part.getAttribute('data-cg-part') === here.getAttribute('data-cg-part')) ?? column[0];
  } else return;
  if (next === undefined) return;
  event.preventDefault();
  focusQuietly(next);
}

interface RowsProps extends PartsScope {
  readonly parts: readonly PartVM[];
  /** The part Tab lands on (the next one to insert; the first when none is next). */
  readonly stop: PartVM | null;
  readonly actions: ReturnType<typeof usePartActions>;
}

function Rows({ parts, stop, mode, confirm, actions }: RowsProps): JSX.Element {
  return (
    <>
      {parts.map((part) => {
        const asking = confirms(confirm, part);
        return (
          <PartRow
            key={`${part.variant ?? 0}:${part.index}`}
            part={part}
            mode={mode}
            tabIndex={part === stop ? 0 : -1}
            confirming={asking}
            onInsert={actions.insert}
            onInsertAgain={actions.insert}
            onCopy={actions.copy}
            onKeyDown={movePartFocus}
          >
            {asking ? <ConfirmRow confirm={confirm} takeFocus={actions.asked} /> : undefined}
          </PartRow>
        );
      })}
    </>
  );
}

const tabStop = (parts: readonly PartVM[]): PartVM | null => parts.find((part) => part.next) ?? parts[0] ?? null;

/** The parts of Reply, Fix, Ping or a one-variant Hi. */
export function Parts({ parts, ...scope }: PartsScope & { readonly parts: readonly PartVM[] }): JSX.Element {
  const actions = usePartActions(scope.opId);
  return (
    <div class="cg-parts" data-cg-parts="">
      <Rows parts={parts} stop={tabStop(parts)} actions={actions} {...scope} />
    </div>
  );
}

/** Hi: three variants side by side on a wide composer, a column on a narrow one (ui-design §4.3). */
export function Variants({ variants, ...scope }: PartsScope & { readonly variants: readonly VariantVM[] }): JSX.Element {
  const i18n = useI18n();
  const actions = usePartActions(scope.opId);
  const stop = tabStop(variants.flatMap((variant) => variant.parts));
  return (
    <div class="cg-hi" data-cg-parts="">
      {variants.map((variant) => {
        const label = i18n.text(variant.label);
        return (
          <div key={variant.index} class="cg-hi__col" role="group" aria-label={label}>
            <div class="cg-vhead">
              <b>{label}</b>
            </div>
            <Rows parts={variant.parts} stop={stop} actions={actions} {...scope} />
          </div>
        );
      })}
    </div>
  );
}
