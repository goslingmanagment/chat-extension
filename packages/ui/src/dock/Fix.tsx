// Fix (ui-design §4.5; AI-020…AI-025, NEW-05): «Ваш текст» above «После Fix»,
// then «Заменить мой черновик ↵» — the click is the consent (Б2), no second
// question — and a quiet «Копировать». After the replacement: «✓ Черновик
// заменён», «Вернуть мой текст» and the seconds left of its 30; then «Вернуть
// текст уже нельзя». Without a verified editor «Заменить» is off with its
// reason and «Копировать ↵» becomes the line button.
//
// The consent is for the draft the field holds at the click, whatever
// happened to it since the Fix was made (decision X26): the replacement never
// asks. Only «Вернуть мой текст» may — the person wrote on after the
// replacement (architecture.md §6.4) — and then the Б2 question of §4.6
// opens under the text in place of the button that asked.

import { type ComponentChildren, type JSX } from 'preact';

import { type ConfirmVM, type FixVM, type PartVM } from '@cg/contracts/vm';

import { Button, ErrorCard, Icon, isComposing, isHeldKey, useCountdown, useI18n, useNowFn } from '../kit';
import { ConfirmRow, confirms, useConfirmFocus, usePartActions } from './Parts';

export interface FixBodyProps {
  readonly opId: string;
  readonly fix: FixVM;
  /** The polished text; Fix answers with one message. */
  readonly part: PartVM;
  readonly mode: 'insert' | 'copy-only';
  /** The Б2 question of this result; drawn when it is about the Fix part. */
  readonly confirm: ConfirmVM | null;
}

function Block({ caption, text, was, children }: { readonly caption: string; readonly text: string; readonly was: boolean; readonly children?: ComponentChildren }): JSX.Element {
  return (
    <div class="cg-fix">
      <span />
      <div>
        <div class="cg-cap">{caption}</div>
        <div class={`cg-fix__t${was ? ' is-was' : ''}`}>{text}</div>
        {children}
      </div>
    </div>
  );
}

export function FixBody({ opId, fix, part, mode, confirm }: FixBodyProps): JSX.Element {
  const i18n = useI18n();
  const now = useNowFn();
  const { copy, run, asked } = usePartActions(opId);
  const onAnswer = useConfirmFocus(confirm);
  const left = useCountdown(fix.replaced && !fix.restoreExpired ? fix.restoreUntil : null, now);
  const seconds = Math.ceil(left / 1000);
  const copied = part.copy === 'done';
  const copyLabel = copied ? i18n.t('common.copied') : i18n.t('common.copy');
  // The question stands where the button that asked was; «Отмена» gives focus back to that button.
  const asking = confirms(confirm, part);
  const question = asking ? <ConfirmRow confirm={confirm} takeFocus={asked} onAnswer={onAnswer} home=".cg-body" asker=".cg-fix__go, .cg-fix__back" /> : null;

  if (fix.replaced) {
    const canRestore = !fix.restoreExpired && fix.restoreUntil !== null && left > 0;
    return (
      <>
        <div class={`cg-fixbox${asking ? ' is-confirm' : ''}`}>
          <Block caption={i18n.t('fix.afterInField')} text={part.text} was>
            {question}
          </Block>
        </div>
        <div class="cg-fix__acts">
          <span class="cg-done">
            <Icon name="check" size={13} />
            {i18n.t('fix.replaced')}
          </span>
          {canRestore ? (
            <>
              {asking ? null : <Button label={i18n.t('fix.restore')} variant="line" class="cg-fix__back" onClick={() => run({ type: 'RestoreMyDraft', operationId: opId }, null)} />}
              <span class="cg-count">{i18n.t('common.seconds', { n: seconds })}</span>
            </>
          ) : (
            <span class="cg-count">{i18n.t('fix.restoreExpired')}</span>
          )}
        </div>
      </>
    );
  }

  const canReplace = fix.canReplace && mode === 'insert';
  const why = fix.replaceReason === null ? null : i18n.text(fix.replaceReason.text);
  // «Черновик заменён. Вернуть можно 30 секунд» (ui-design §6.2).
  const replace = (): void => run({ type: 'ReplaceMyDraft', operationId: opId, part: part.index }, `${i18n.t('fix.replaced')}. ${i18n.t('fix.restore')}: ${i18n.t('common.seconds', { n: 30 })}`);
  return (
    <>
      <div
        class={`cg-fixbox${asking ? ' is-confirm' : ''}`}
        role="group"
        aria-label={i18n.t('fix.after')}
        tabIndex={0}
        onKeyDown={(event) => {
          // Enter on the block is «Заменить мой черновик» (ui-design §6.4); without a verified editor it copies.
          if (event.target !== event.currentTarget || event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || isComposing(event)) return;
          event.preventDefault();
          // One press, one replacement: not on a held key, not while one is on its way, not over an open question.
          if (isHeldKey(event) || part.insert === 'pending' || asking) return;
          if (canReplace) replace();
          else copy(part);
        }}
      >
        <Block caption={i18n.t('fix.yourText')} text={fix.sourceDraft} was />
        <Block caption={i18n.t('fix.after')} text={part.text} was={false}>
          {question}
        </Block>
      </div>
      <div class="cg-fix__acts">
        {asking ? null : (
          <Button
            label={i18n.t('fix.replace')}
            variant="line"
            class="cg-fix__go"
            hotkey={canReplace ? '↵' : null}
            busy={part.insert === 'pending'}
            reason={canReplace ? null : (why ?? i18n.t('fix.cannotCheck'))}
            onClick={replace}
          />
        )}
        <Button
          label={copyLabel}
          icon={copied ? 'check' : 'copy'}
          variant={canReplace ? 'quiet' : 'line'}
          class="cg-copy-main"
          hotkey={canReplace ? null : '↵'}
          onClick={() => copy(part)}
        />
        {canReplace ? null : <span class="cg-fix__why">{why ?? i18n.t('fix.cannotCheck')}</span>}
      </div>
      {part.insert === 'failed' && part.insertError !== null ? (
        <div class="cg-fix__card">
          <ErrorCard error={part.insertError} tone="failure" inline />
        </div>
      ) : null}
      {part.copy === 'failed' && part.copyError !== null ? (
        <div class="cg-fix__card">
          <ErrorCard error={part.copyError} tone="failure" inline copyCode={false} />
        </div>
      ) : null}
    </>
  );
}
