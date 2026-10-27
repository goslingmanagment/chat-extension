// The open fan's warning marks in Fansly's chat header (hub `clientFanMarks`; contracts fan-marks-fansly.ts): what the
// header shows of the background's answer, and when it asks. One read per opened chat: the chat a person opens (its
// page, fan and username) is asked once, a sync while it stays open asks nothing, and opening it again asks again (the
// background answers from its ten-minute cache). The tab keeps the last answers of this document, so a chat opened
// again shows its marks at once. Nothing while loading, nothing on a failed read: a mark shows only when it applies.
import type { FanMarksClient, FanMarksListGroup, FanMarksPostView, FanMarksView } from '@cg/contracts/fan-marks-fansly';
import type { FanslyFanMarks } from '@cg/contracts/tab-messages-fansly';

export interface FanMarksTarget {
  readonly pageId: number;
  readonly accountId: string;
  readonly fanId: string;
  /** The fan's username as the page shows it; null — not known yet. */
  readonly username: string | null;
}

export type FanMarksAnswer = { readonly ok: true; readonly marks: FanslyFanMarks } | { readonly ok: false };

export const FAN_MARKS_NONE: FanMarksView = { lists: null, posts: [] };
/** Answers the tab keeps for chats opened again; the oldest goes first. */
const KEPT = 50;

const lower = (value: string): string => value.trim().replace(/^@/, '').toLowerCase();

/** What the header shows of an answer: the lists by label (this page first), the posts that read; nothing — FAN_MARKS_NONE. */
export function fanMarksView(marks: FanslyFanMarks, username: string | null): FanMarksView {
  const groups: { label: string; here: boolean; names: string[] }[] = [];
  // The asked page's list first, whatever order the answer has.
  for (const list of [...marks.lists].sort((a, b) => Number(b.here) - Number(a.here))) {
    const label = list.label.trim();
    if (label === '') continue;
    let group = groups.find((entry) => entry.label === label);
    if (group === undefined) groups.push((group = { label, here: false, names: [] }));
    if (list.here) group.here = true;
    else if (list.name.trim() !== '' && !group.names.includes(list.name.trim())) group.names.push(list.name.trim());
  }
  const shown: FanMarksListGroup[] = groups.filter((group) => group.here || group.names.length > 0);
  const posts: FanMarksPostView[] = [];
  for (const post of marks.blocklist) {
    const postedAt = Date.parse(post.postedAt);
    if (!Number.isFinite(postedAt)) continue;
    posts.push({ postedAt, text: post.text.trim(), author: post.author?.trim() || null, link: post.link, handle: post.handle, renamed: username !== null && lower(post.handle) !== '' && lower(post.handle) !== lower(username) });
  }
  posts.sort((a, b) => b.postedAt - a.postedAt);
  const first = shown[0];
  return first === undefined && posts.length === 0 ? FAN_MARKS_NONE : { lists: first === undefined ? null : { label: first.label, groups: shown }, posts };
}

export function createFanMarks(deps: {
  /** Who is signed in where: a new one forgets every answer. */
  session(): string | null;
  target(): FanMarksTarget | null;
  read(target: FanMarksTarget): Promise<FanMarksAnswer>;
}): FanMarksClient & { sync(): void; dispose(): void } {
  let session: string | null = null;
  /** The chat open now, by page, fan and username; null — none (a chat closed and opened again is a new visit). */
  let visit: string | null = null;
  let view: FanMarksView = FAN_MARKS_NONE;
  let disposed = false;
  const kept = new Map<string, FanMarksView>();
  const listeners = new Set<(view: FanMarksView) => void>();
  const show = (next: FanMarksView): void => {
    if (next === view) return;
    view = next;
    for (const listener of [...listeners]) listener(view);
  };
  const keep = (key: string, value: FanMarksView): void => {
    kept.delete(key);
    kept.set(key, value);
    while (kept.size > KEPT) kept.delete(kept.keys().next().value as string);
  };
  return {
    view: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    sync() {
      if (disposed) return;
      const now = deps.session();
      if (now !== session) {
        session = now;
        visit = null;
        kept.clear();
      }
      const target = now === null ? null : deps.target();
      const key = target === null ? null : `${String(target.pageId)}|${target.accountId}|${target.fanId}|${target.username ?? ''}`;
      if (key === visit) return;
      visit = key;
      if (target === null || key === null) {
        show(FAN_MARKS_NONE);
        return;
      }
      show(kept.get(key) ?? FAN_MARKS_NONE);
      const under = session;
      void deps.read(target).then(
        (answer) => {
          // A failed read changes nothing: no mark appears, none goes.
          if (disposed || !answer.ok || session !== under) return;
          const next = fanMarksView(answer.marks, target.username);
          keep(key, next);
          if (visit === key) show(next);
        },
        () => undefined,
      );
    },
    dispose() {
      disposed = true;
      kept.clear();
      listeners.clear();
    },
  };
}
