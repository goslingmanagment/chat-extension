// The open fan's warning marks for Fansly's chat header (`fansly.marks.read`, contracts tab-messages-fansly.ts): the
// hub's `clientFanMarks` — the agency's lists labelled like «💩 Бомж» the fan is in, on any of its Fansly pages, and
// FANSLY BLOCKLIST's posts about the fan's username. Only for a tab granted the creator's page where the manifest admits
// `fan-marks` (a hub with `fan-marks-v1`; no owner switch).
//
// The tab asks once per opened chat. Each page's and fan's answer is kept ten minutes for the person signed in, so a
// chat opened again (in this tab or another) is answered from it, and a call while a read is in flight joins it. An
// answer with no mark is kept one minute: a fan reported to the blocklist a moment ago shows on the next opening once
// the hub has read the post (Ivan reopened such a chat within the ten minutes, 2026-10-30). A failed read is not kept:
// it is answered as its failure, and only the next opening of the chat asks again. The hub's
// answer is bounded to what a tab shows: a post's link only when it is a `https://t.me/` one.

import type { CgAnyErrorWire } from '@cg/contracts/errors-fansly';
import type { FeatureSlice } from '@cg/contracts/features/types';
import type { FanMarks } from '@cg/contracts/hub';
import { FANSLY_TAB_LIMITS, type FanslyFanMarks, type FanslyTabRequestPayload, type FanslyTabResponsePayload } from '@cg/contracts/tab-messages-fansly';
import { admittedOn } from '@cg/core/domain/features';
import { flagRefusal } from '@cg/core/domain/ops';

import type { BackgroundKit, HostSiteSender } from '../../src/composition/background/host-module';

type Request = FanslyTabRequestPayload<'fansly.marks.read'>;
type Answer = FanslyTabResponsePayload<'fansly.marks.read'>;

/** How long a page's and fan's answer is kept (one with no mark, shorter); how many are kept at most (the oldest goes first). */
export const FAN_MARKS_CACHE = { ttlMs: 10 * 60_000, emptyTtlMs: 60_000, max: 200 } as const;

/** A Telegram post's own address: `https://t.me/c/<chat>/<message>` (or a public group's `https://t.me/<name>/<message>`). */
const TELEGRAM_LINK = /^https:\/\/t\.me\/[\w/+-]+$/;

/** At most `max` UTF-16 units, never half of a pair. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const end = /[\uD800-\uDBFF]/.test(text.charAt(max - 1)) ? max - 1 : max;
  return text.slice(0, end);
}

const isoOf = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

/** The hub's answer as a tab may take it (FanslyFanMarksSchema): bounded, the asked page's lists marked `here`. */
export function boundFanMarks(marks: FanMarks, pageLabel: string): FanslyFanMarks {
  const lists: FanslyFanMarks['lists'][number][] = [];
  for (const list of marks.lists) {
    const label = cut(list.label.trim(), 120);
    if (label === '') continue;
    lists.push({ here: list.pageLabel === pageLabel, name: cut((list.modelName ?? '').trim() || list.pageLabel.trim(), 120), label, since: isoOf(list.since) });
    if (lists.length === FANSLY_TAB_LIMITS.fanMarkListsMax) break;
  }
  const blocklist: FanslyFanMarks['blocklist'][number][] = [];
  for (const post of marks.blocklist) {
    const postedAt = isoOf(post.postedAt);
    if (postedAt === null) continue;
    const author = post.author === null ? '' : cut(post.author.trim(), 120);
    const link = post.link.trim();
    blocklist.push({
      postedAt,
      text: cut(post.text, FANSLY_TAB_LIMITS.fanMarkPostMaxChars),
      author: author === '' ? null : author,
      link: link.length <= 200 && TELEGRAM_LINK.test(link) ? link : null,
      handle: cut(post.handle.trim().replace(/^@/, ''), 64),
    });
    if (blocklist.length === FANSLY_TAB_LIMITS.fanMarkPostsMax) break;
  }
  return { lists, blocklist };
}

interface Held {
  readonly at: number;
  answer: Promise<Answer>;
  settled: boolean;
  ok: boolean;
  /** The answer named no list and no post. */
  empty: boolean;
}

export interface FanMarksReader {
  read(request: Request, sender: HostSiteSender): Promise<Answer>;
  /** Forgets every answer (another person signed in). */
  clear(): void;
}

const fail = (error: CgAnyErrorWire): Answer => ({ ok: false, error });

export function createFanMarksReader(kit: Pick<BackgroundKit, 'hub' | 'clock' | 'networkSession' | 'log'>, slice: FeatureSlice): FanMarksReader {
  const kept = new Map<string, Held>();

  async function ask(held: Held, pageLabel: string, request: Request): Promise<Answer> {
    try {
      const marks = boundFanMarks(await kit.hub.facade.fanMarks({ pageLabel, fanRef: request.fanRef, ...(request.username === undefined ? {} : { username: request.username }) }), pageLabel);
      held.ok = true;
      held.empty = marks.lists.length === 0 && marks.blocklist.length === 0;
      return { ok: true, marks };
    } catch (error) {
      const wire = kit.hub.errorWire(error);
      kit.log.service({ level: 'warn', scope: 'fansly.marks', msg: 'marks not read', fields: { code: wire.code } });
      return fail(wire);
    }
  }

  return {
    async read(request, sender) {
      if (sender.kind !== 'tab') return fail({ code: 'CG-CONTEXT-CHANGED' });
      const grant = await kit.hub.page(request.pageId, sender);
      if (!grant.ok) return fail({ code: grant.code });
      // The creator's page (by either of the tab's ids for the creator, as «Онлайн» finds it).
      const bootstrap = kit.hub.bootstrap();
      const page = bootstrap?.pages.find((entry) => entry.pageId === request.pageId);
      const ids = [request.hostAccountId, ...(kit.networkSession?.aliases(request.hostAccountId) ?? [])];
      if (bootstrap === null || page === undefined || page.platform !== 'fansly' || page.platformAccountId === null || !ids.includes(page.platformAccountId)) return fail({ code: 'CG-BINDING-NOT-GRANTED' });
      const admitted = admittedOn(slice, 'fan-marks', null, bootstrap, page);
      if (!admitted.usable) return fail(flagRefusal(admitted));
      const who = kit.hub.session();
      if (who === null) return fail({ code: 'CG-CONTEXT-CHANGED' });
      const pageLabel = grant.page.pageLabel;
      const key = [who.hubOrigin, String(who.userId), pageLabel, request.fanRef, request.username ?? ''].join('|');
      const now = kit.clock.now();
      const held = kept.get(key);
      if (held !== undefined && (!held.settled || now - held.at < (held.empty ? FAN_MARKS_CACHE.emptyTtlMs : FAN_MARKS_CACHE.ttlMs))) return held.answer;
      kept.delete(key);
      // Set before anything is awaited: a call that comes meanwhile joins this read.
      const next: Held = { at: now, answer: Promise.resolve(fail({ code: 'CG-HUB-UNKNOWN' })), settled: false, ok: false, empty: false };
      next.answer = ask(next, pageLabel, request).finally(() => {
        next.settled = true;
        // A failure is not kept: the next opening of the chat asks again.
        if (!next.ok && kept.get(key) === next) kept.delete(key);
      });
      kept.set(key, next);
      while (kept.size > FAN_MARKS_CACHE.max) kept.delete(kept.keys().next().value as string);
      return next.answer;
    },
    clear() {
      kept.clear();
    },
  };
}
