// The chat's length in Fansly's own chat header (2026-11-08, the owner: «хочу еще видеть сколько было месаг с челом,
// аккуратный такой баджик… чтобы чаттеры видели как давно общение»): after «Регистрация», a quiet pill with the speech
// bubble, how many messages the chat ever had and how long ago it began, «428 · 3 мес». Its title says it in full, with
// the date. No count when the hub cannot say it exactly: the pill keeps only the age. Nothing to press, nothing it blocks.
// In that row's size and ink like «Регистрация»; the pill is 16 px and leans out of the 14 px row by a pixel each way,
// so the row keeps its height.
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import type { ChatLengthClient, ChatLengthCopy, ChatLengthView } from '@cg/contracts/deleted-fansly';

import { Icon, useI18n, useNowFn, type SurfaceDefinition } from '../../kit';

function useView(client: ChatLengthClient): ChatLengthView | null {
  const [view, setView] = useState(() => client.view());
  useEffect(() => {
    setView(client.view());
    return client.subscribe(setView);
  }, [client]);
  return view;
}

export function chatLengthSurface(client: ChatLengthClient, texts: Readonly<Record<'ru' | 'en', ChatLengthCopy>>): SurfaceDefinition {
  function ChatLength(): JSX.Element | null {
    const copy = texts[useI18n().language];
    const now = useNowFn();
    const view = useView(client);
    if (view === null) return null;
    const title = copy.title(view.messages, view.since);
    return (
      <span class="cg-cl" data-chat-length={view.messages === null ? 'unknown' : String(view.messages)} title={title}>
        <span aria-hidden="true" class="cg-cl__divider">
          |
        </span>
        <span class="cg-cl__pill cg-num" role="img" aria-label={title}>
          <Icon name="bubble" size={12} />
          {view.messages === null ? null : (
            <>
              <span class="cg-cl__count">{copy.count(view.messages)}</span>
              <span aria-hidden="true" class="cg-cl__dot">
                ·
              </span>
            </>
          )}
          <span class="cg-cl__age">{copy.age(view.since, now())}</span>
        </span>
      </span>
    );
  }
  return {
    view: ChatLength,
    styles: [
      {
        id: 'cg-chat-length',
        css: `
    :host { display: inline-flex; }
    .cg-root[data-cg-surface='header-slot'] { container-type: normal; }
    .cg-cl { display: inline-flex; align-items: center; gap: 4px; color: var(--cg-ink-muted); font-size: 12px; line-height: 14px; white-space: nowrap; cursor: default; }
    .cg-cl__divider { margin: 0 2px; }
    .cg-cl__pill {
      display: inline-flex; align-items: center; gap: 4px; height: 16px; margin: -1px 0; padding: 0 7px 0 5px; box-sizing: border-box;
      border-radius: var(--cg-r-pill); background: var(--cg-chip); box-shadow: inset 0 0 0 1px var(--cg-rule-2);
      color: var(--cg-ink-2); font-size: 11px; line-height: 16px; font-weight: 500; font-variant-numeric: tabular-nums;
    }
    .cg-cl__pill svg { flex: none; color: var(--cg-ink-muted); }
    .cg-cl__count { color: var(--cg-ink-strong); font-weight: 600; }
    .cg-cl__dot { color: var(--cg-ink-muted); }
  `,
      },
    ],
  };
}
