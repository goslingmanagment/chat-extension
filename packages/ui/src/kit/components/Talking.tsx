// «В разговоре» (Chat Memory week 1): another chatter wrote to this fan in the last 15 minutes. A warning a chatter
// can pass, never a block — nobody owns a fan. Two shapes, both from the one `talking` view, both by the chat of a
// target handle:
// - the mark on a fan's row in our own lists (Spenders, «Ожидают ответа», «Новые», ⌘K, the quick jump): «в разговоре:
//   Никита» — never in the site's own chat list;
// - the notice of the open chat in the dock: «С ним сейчас говорит Никита · 4 мин назад» with «Понятно», which hides it
//   for this chat until the mark changes (the other chatter writes again).
// Neutral ink: an attribute of a fan, never our accent.

import { type JSX } from 'preact';
import { useLayoutEffect, useState } from 'preact/hooks';

import { talkingKeyOfHandle, type TalkingMarkVM, type TargetHandle } from '@cg/contracts/vm';

import { useMinuteClock } from '../clock';
import { useI18n, useKit } from '../context';
import { Button } from './Button';
import { Dot } from './Indicators';

const NONE: Readonly<Record<string, TalkingMarkVM>> = {};

/**
 * The marks of the `talking` view. A surface mounted where nobody serves the view (an extension page, a test's own
 * client) shows none instead of failing: a mark is an addition to a row, never a reason for the row not to draw.
 */
function useTalkingMarks(): Readonly<Record<string, TalkingMarkVM>> {
  const client = useKit().deps.client;
  const read = (): Readonly<Record<string, TalkingMarkVM>> => {
    try {
      return client.getSnapshot({ of: 'talking' }).marks;
    } catch {
      return NONE;
    }
  };
  const [marks, setMarks] = useState(read);
  useLayoutEffect(() => {
    setMarks(read());
    return client.subscribe({ of: 'talking' }, (next) => setMarks(next.marks));
  }, [client]);
  return marks;
}

/** The mark of a handle's chat; null — nobody else is talking to the fan. */
function useTalking(handle: TargetHandle | null): { readonly key: string; readonly mark: TalkingMarkVM } | null {
  const marks = useTalkingMarks();
  const key = handle === null ? null : talkingKeyOfHandle(handle);
  const mark = key === null ? undefined : marks[key];
  return key === null || mark === undefined ? null : { key, mark };
}

export function TalkingMark({ handle }: { readonly handle: TargetHandle | null }): JSX.Element | null {
  const i18n = useI18n();
  const talking = useTalking(handle);
  if (talking === null) return null;
  return (
    <span class="cg-talk" data-cg-talking="mark">
      <Dot kind="ring" size={6} />
      {i18n.t('talking.mark', { names: talking.mark.names.join(', ') })}
    </span>
  );
}

/** Notices hidden with «Понятно», by chat: the message time they were hidden for. A newer message shows it again. */
const hidden = new Map<string, string>();

export function TalkingNotice({ handle }: { readonly handle: TargetHandle | null }): JSX.Element | null {
  const i18n = useI18n();
  const talking = useTalking(handle);
  const [, bump] = useState(0);
  useMinuteClock(talking !== null);
  if (talking === null || hidden.get(talking.key) === talking.mark.lastSentAt) return null;
  const { key, mark } = talking;
  return (
    <div class="cg-talk-note" role="status" data-cg-talking="notice">
      <Dot kind="ring" size={6} />
      <span class="cg-talk-note__text">{i18n.t('talking.notice', { names: mark.names.join(', '), age: i18n.formatAge(mark.lastSentAt) })}</span>
      <Button
        label={i18n.t('talking.ok')}
        variant="quiet"
        class="cg-talk-note__ok"
        onClick={() => {
          hidden.set(key, mark.lastSentAt);
          bump((n) => n + 1);
        }}
      />
    </div>
  );
}

export const TALKING_CSS = `
.cg-talk { display: inline-flex; align-items: center; gap: 4px; flex: none; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: var(--cg-text-2xs); color: var(--cg-ink-2); }
.cg-talk-note { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-top: 1px solid var(--cg-rule-2); background: var(--cg-raised); font-size: var(--cg-text-xs); color: var(--cg-ink-2); }
.cg-talk-note__text { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.cg-talk-note__ok { flex: none; }
`;
