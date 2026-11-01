// «Рассылки» in the head of the window (2026-11-01, Dmitriy: «локально хранить состояние всех рассылок, чтобы можно было к
// любой вернуться с того же момента»): the page's outreaches kept on this computer, newest first — each with its text,
// when it started and how far it got — and «Новая рассылка». A click on one makes it the window's again, as it was left:
// its versions, the person's words, what went and what came of it. Nothing is written or sent by the click.

import { type JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { type OutreachSavedVM, type OutreachWindowVM } from '@cg/contracts/vm';

import { Button, CheckGlyph, Icon, useDispatch, useI18n, useKit } from '../kit';

/** «сегодня 01:20 · отправлено 12 из 20 · ответили 2 · купили на $50 · с медиа». */
function metaOf(i18n: ReturnType<typeof useI18n>, item: OutreachSavedVM): string {
  const parts = [i18n.formatTime(item.startedAt, 'datetime')];
  if (item.total === 0) parts.push(i18n.t('outreach.saved.notWritten'));
  else parts.push(i18n.t('outreach.saved.sentOf', { sent: item.sent, total: item.total }));
  if (item.replied > 0) parts.push(i18n.t('outreach.saved.replied', { n: item.replied }));
  if (item.boughtMills !== null && item.boughtMills > 0) parts.push(i18n.t('outreach.saved.bought', { money: i18n.formatMoneyMills(item.boughtMills) }));
  if (item.media) parts.push(i18n.t('outreach.saved.media'));
  return parts.join(' · ');
}

export function Saved({ vm }: { readonly vm: OutreachWindowVM }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const { root } = useKit();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  // A press outside the list closes it; Esc closes it before anything else of the window.
  useEffect(() => {
    if (!open) return undefined;
    const away = (event: Event): void => {
      if (box.current !== null && !event.composedPath().includes(box.current)) setOpen(false);
    };
    root.addEventListener('pointerdown', away, true);
    return () => root.removeEventListener('pointerdown', away, true);
  }, [open, root]);
  useEffect(() => {
    if (open) box.current?.querySelector<HTMLElement>('.cg-ow__pib')?.focus();
  }, [open]);

  if (vm.saved.length === 0) return null;
  const close = (): void => {
    setOpen(false);
    button.current?.focus();
  };
  const current = vm.saved.find((item) => item.current) ?? null;

  return (
    <span
      class="cg-ow__saved"
      ref={box}
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <Button
        label={i18n.t('outreach.saved.button', { n: vm.saved.length })}
        variant="quiet"
        size="sm"
        class="cg-ow__savedb"
        haspopup="dialog"
        expanded={open}
        buttonRef={button}
        tooltip={open ? null : i18n.t('outreach.saved.tooltip')}
        trailing={<Icon name="chevronDown" size={14} />}
        onClick={() => setOpen((value) => !value)}
      />
      {open ? (
        <div class="cg-ow__pop cg-ow__savedpop" role="dialog" aria-label={i18n.t('outreach.saved.head')}>
          <div class="cg-ow__poph">{i18n.t('outreach.saved.head')}</div>
          {current === null ? null : (
            <div class="cg-ow__pi cg-ow__new">
              <button
                type="button"
                class="cg-ow__pib"
                onClick={() => {
                  close();
                  void dispatch({ type: 'SetOutreach', fresh: true });
                }}
              >
                <Icon name="pencil" size={14} />
                <span>{i18n.t('outreach.summary.fresh')}</span>
              </button>
            </div>
          )}
          {vm.saved.map((item) => (
            <div key={item.id === '' ? 'now' : item.id} class={`cg-ow__pi${item.current ? ' is-on' : ''}`} data-cg-saved={item.current ? 'current' : item.id}>
              <button
                type="button"
                class="cg-ow__pib"
                aria-current={item.current ? 'true' : undefined}
                onClick={() => {
                  close();
                  if (!item.current) void dispatch({ type: 'SetOutreach', resume: item.id });
                }}
              >
                <CheckGlyph on={item.current} size={14} />
                <span>
                  <b class="cg-ow__savedt">{item.text.trim() === '' ? i18n.t('outreach.saved.noText') : item.text}</b>
                  <small class="cg-num">{metaOf(i18n, item)}</small>
                </span>
              </button>
              {item.current ? <i>{i18n.t('outreach.saved.now')}</i> : null}
            </div>
          ))}
          <div class="cg-ow__popf">{i18n.t('outreach.saved.foot')}</div>
        </div>
      ) : null}
    </span>
  );
}
