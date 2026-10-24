// The quick-jump popup of Alt+1–9 (architecture.md §9.1, D-30; ui-design §10;
// NEW-07, HK-037): shown while Alt (⌥) is held (X45), it lists the first nine
// chats of the list the person already sees, each with its digit on the
// right. It is the palette's dialog shape, but not modal: the keys stay with
// the early dispatcher and focus stays in the composer. A click on a row
// goes to that chat (the action its controller prepared).

import { type JSX } from 'preact';

import { type QuickJumpVM } from '@cg/contracts/vm';

import { OverlayLayer, TalkingMark, ViewState, useDispatch, useI18n, useView } from '../kit';

function Row({ item }: { readonly item: QuickJumpVM['items'][number] }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const unread = item.unread !== null && item.unread > 0 ? item.unread : null;
  return (
    <li>
      <button type="button" class={`cg-pal__item cg-qj__item${unread === null ? '' : ' is-unread'}`} tabIndex={-1} onClick={() => void dispatch(item.action)}>
        <span class="cg-pal__main">
          <b>{item.name ?? i18n.t('common.unknown')}</b>
          {item.username === null ? null : <span class="cg-pal__sub">@{item.username}</span>}
          {unread === null ? null : <span class="cg-pal__sub cg-num">{i18n.plural('quickJump.unread', unread)}</span>}
          {item.action.type === 'Navigate' && item.action.to.kind === 'chat' ? <TalkingMark handle={item.action.to.targetHandle} /> : null}
        </span>
        <span class="cg-pal__right">
          <kbd>{item.slot}</kbd>
        </span>
      </button>
    </li>
  );
}

export function QuickJump(): JSX.Element {
  const i18n = useI18n();
  const vm = useView({ of: 'quick-jump' }).value;
  const listed = (vm.view.s === 'ready' || vm.view.s === 'partial') && vm.items.length > 0;
  return (
    <OverlayLayer>
      <div class="cg-dialog cg-dialog--center cg-qj" role="dialog" aria-label={i18n.t('quickJump.title')} data-cg-quickjump={vm.view.s}>
        <h2 class="cg-qj__title">{i18n.t('quickJump.title')}</h2>
        {listed ? (
          <ol class="cg-qj__list">
            {vm.items.map((item) => (
              <Row key={item.slot} item={item} />
            ))}
          </ol>
        ) : (
          <ViewState view={vm.view.s === 'ready' || vm.view.s === 'partial' ? { s: 'empty', why: { key: 'quickJump.empty' } } : vm.view} />
        )}
      </div>
    </OverlayLayer>
  );
}

export const QUICK_JUMP_CSS = `
.cg-qj { width: min(420px, calc(100vw - 32px)); }
.cg-qj__title { flex: none; padding: 10px 16px 4px; font-size: var(--cg-text-sm); line-height: 18px; font-weight: 400; color: var(--cg-ink-muted); }
.cg-qj__list { margin: 0; padding: 0 6px 8px; list-style: none; overflow-y: auto; }
.cg-qj__item { width: 100%; text-align: left; }
.cg-qj__item:hover { background: var(--cg-hover); }
.cg-qj__item.is-unread b { font-weight: 600; color: var(--cg-ink-strong); }
.cg-qj__item kbd { color: var(--cg-ink-strong); font-size: var(--cg-text-sm); }
`;
