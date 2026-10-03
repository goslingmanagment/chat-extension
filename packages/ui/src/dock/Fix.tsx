// Fix (ui-design §4.5; AI-020…AI-025, NEW-05): «Ваш текст» above «После Fix»,
// then «Заменить мой черновик ↵» — the click is the consent (Б2), no second
// question — and a quiet «Копировать». After the replacement: «✓ Черновик
// заменён», «Вернуть мой текст» and the seconds left of its 30; then «Вернуть
// текст уже нельзя». Without a verified editor «Заменить» is off with its
// reason and «Копировать ↵» becomes the line button.

import { type JSX } from 'preact';

import { type FixVM, type PartVM } from '@cg/contracts/vm';

import { Button, ErrorCard, Icon, useAnnounce, useCountdown, useDispatch, useI18n, useNowFn } from '../kit';
import { usePartActions } from './Parts';

export interface FixBodyProps {
  readonly opId: string;
  readonly fix: FixVM;
  /** The polished text; Fix answers with one message. */
  readonly part: PartVM;
  readonly mode: 'insert' | 'copy-only';
}

function Block({ caption, text, was }: { readonly caption: string; readonly text: string; readonly was: boolean }): JSX.Element {
  return (
    <div class="cg-fix">
      <span />
      <div>
        <div class="cg-cap">{caption}</div>
        <div class={`cg-fix__t${was ? ' is-was' : ''}`}>{text}</div>
      </div>
    </div>
  );
}

export function FixBody({ opId, fix, part, mode }: FixBodyProps): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const announce = useAnnounce();
  const now = useNowFn();
  const { copy } = usePartActions(opId);
  const left = useCountdown(fix.replaced && !fix.restoreExpired ? fix.restoreUntil : null, now);
  const seconds = Math.ceil(left / 1000);
  const copied = part.copy === 'done';
  const copyLabel = copied ? i18n.t('common.copied') : i18n.t('common.copy');

  if (fix.replaced) {
    const canRestore = !fix.restoreExpired && fix.restoreUntil !== null && left > 0;
    return (
      <>
        <Block caption={i18n.t('fix.afterInField')} text={part.text} was />
        <div class="cg-fix__acts">
          <span class="cg-done">
            <Icon name="check" size={13} />
            {i18n.t('fix.replaced')}
          </span>
          {canRestore ? (
            <>
              <Button label={i18n.t('fix.restore')} variant="line" onClick={() => void dispatch({ type: 'RestoreMyDraft', operationId: opId })} />
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
  const replace = (): void => {
    void dispatch({ type: 'ReplaceMyDraft', operationId: opId, part: part.index }).then((receipt) => {
      // «Черновик заменён. Вернуть можно 30 секунд» (ui-design §6.2).
      if (receipt?.ok === true && receipt.outcome === 'done') announce(`${i18n.t('fix.replaced')}. ${i18n.t('fix.restore')}: ${i18n.t('common.seconds', { n: 30 })}`);
    });
  };
  return (
    <>
      <div
        class="cg-fixbox"
        role="group"
        aria-label={i18n.t('fix.after')}
        tabIndex={0}
        onKeyDown={(event) => {
          // Enter on the block is «Заменить мой черновик» (ui-design §6.4); without a verified editor it copies.
          if (event.target !== event.currentTarget || event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
          event.preventDefault();
          if (canReplace) replace();
          else copy(part);
        }}
      >
        <Block caption={i18n.t('fix.yourText')} text={fix.sourceDraft} was />
        <Block caption={i18n.t('fix.after')} text={part.text} was={false} />
      </div>
      <div class="cg-fix__acts">
        <Button
          label={i18n.t('fix.replace')}
          variant="line"
          class="cg-fix__go"
          hotkey={canReplace ? '↵' : null}
          busy={part.insert === 'pending'}
          reason={canReplace ? null : (why ?? i18n.t('fix.cannotCheck'))}
          onClick={replace}
        />
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
