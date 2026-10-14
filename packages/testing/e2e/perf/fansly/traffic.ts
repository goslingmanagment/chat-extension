// What reaches an idle Fansly tab anyway (R20 P3d, P16a): fans of other chats
// type and write while nobody touches the page — so «idle» measures what a
// subject does with the page's socket traffic too (the old extension's tap
// parses every frame and plays its sound with the sounds on, plan.md SN-018),
// not a silent socket. The fake Fansly sends it the way the site does (`5/22`
// typing, `5/1` messages); every run of every subject gets the same series:
// every `everyMs`, a typing frame in one chat and, half a period later, a
// message in another — never in the chat that is open.

import { fakeFansly } from '../../support/fansly-stand';

export interface Traffic {
  stop(): Promise<{ readonly typing: number; readonly messages: number; readonly failed: number }>;
}

export function startTraffic(groups: readonly string[], openGroup: () => string, everyMs = 10_000): Traffic {
  const counts = { typing: 0, messages: 0, failed: 0 };
  let step = 0;
  let pending: Promise<unknown> = Promise.resolve();
  const others = (): string[] => groups.filter((group) => group !== openGroup());
  const send = (kind: 'typing' | 'message'): void => {
    const pool = others();
    const groupId = pool[step % pool.length];
    step += 1;
    if (groupId === undefined) return;
    const command = kind === 'typing' ? { op: 'typing' as const, groupId } : { op: 'message' as const, groupId, text: `still there? (${String(counts.messages + 1)})` };
    pending = pending
      .then(() => fakeFansly().command(command))
      .then(
        () => (kind === 'typing' ? (counts.typing += 1) : (counts.messages += 1)),
        () => (counts.failed += 1),
      );
  };
  const typing = setInterval(() => send('typing'), everyMs);
  let message: ReturnType<typeof setInterval> | null = null;
  const offset = setTimeout(() => {
    send('message');
    message = setInterval(() => send('message'), everyMs);
  }, everyMs / 2);
  return {
    stop: async () => {
      clearInterval(typing);
      clearTimeout(offset);
      if (message !== null) clearInterval(message);
      await pending;
      return { ...counts };
    },
  };
}
