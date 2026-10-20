// What MAIN gives the isolated side about a chat (docs/project-unite/
// architecture.md §5.7, §5.8, §6; FS-TAIL-6, FS-TAIL-7, FS-AI-2):
// - the **view** of a group — `fx.chat` for the focused one, `fx.windowMeta`
//   for any: who its fan is, its kind, the DM rules, and its window without a
//   text (how many messages held, the newest, completeness, whether the start
//   is proven, the fan's script for the language gate);
// - the **generation snapshot** (`fx.generationSnapshot`), on the person's
//   click, in one synchronous step after a bounded drain of the deferred parse
//   (the runtime's): identity, epochs, completeness — `unknown` with its
//   reason — the check window (the chat's last min(60, messageCount) messages
//   not seen deleted, never older than its continuous observation), the fan's
//   last ≤ 10 of them, the deleted ones of its span; for Hi the tab's start
//   proof (`StartProofV1`, while its base lives) and the fan's avatar; for Reply,
//   Fix, Hi and Ping the texts of the window. Media-only messages are in the
//   window, never in the tail (the hub takes no empty text); a text over the
//   hub's limit of one message is cut to it, as the core cuts ChatSpace's;
//   a text MAIN no longer holds is a dropped one: `truncated`. The answer frame
//   is ≤ 128 KiB of UTF-8: the oldest texts go first, `truncated`;
// - null — MAIN does not know the creator, the group or its one fan (a group
//   chat): no snapshot, and the generation goes on unchecked (FS-TAIL-7).
// The requests are checked by hand, as the contracts' fixtures have them
// (protocol.test.ts runs them through these checks).

import { count, int, is, isId, orNull, shape, type Plain } from '@cg/host-kit/main/check';

import type { Identity } from './identity';
import { compareIds, DELETED, FAN, isoOf, TEXT, timeOf, type Chat, type Observation } from './observation';
import {
  AUTOMATED_IDS_MAX,
  CHECK_WINDOW_MAX,
  COMPLETE,
  FEATURE_HI,
  FEATURES,
  KNOWN_FAN_MAX,
  PROOF_TAB,
  SCRIPT_CYRILLIC,
  SCRIPT_OTHER,
  SNAPSHOT_MAX_BYTES,
  TAIL_TEXT_MAX_CHARS,
  TEXT_FEATURES,
  UNKNOWN,
  WHY_NOT_CERTIFIED,
  WHY_PENDING_PARSE,
  WHY_UNSEEN,
} from './protocol';

export interface SnapshotRequest {
  readonly groupId: string;
  readonly feature: string;
  readonly window: number;
  readonly withText: boolean;
}

/** `fx.focus {groupId | null, routeEpoch}`. */
export const isFocus = /* @__PURE__ */ shape({ groupId: orNull(isId), routeEpoch: count });
/** `fx.windowMeta {groupId}`. */
export const isGroupForFan = /* @__PURE__ */ shape({ creatorId: isId, fanId: isId });
export const isWindowRequest = /* @__PURE__ */ shape({ groupId: isId });
const isSnapshotShape = /* @__PURE__ */ shape({ groupId: isId, feature: is(...FEATURES), window: int(1), withText: is(true, false) });
/** `fx.generationSnapshot`: text for every supported AI snapshot feature (X70). */
export const isSnapshotRequest = (payload: unknown): payload is SnapshotRequest =>
  isSnapshotShape(payload) && (!(payload as SnapshotRequest).withText || TEXT_FEATURES.includes((payload as SnapshotRequest).feature));

/** What the frame's envelope adds to the snapshot's JSON, generously: `{v, kind, id, t, documentEpoch, seq, ok, data}`. */
const ENVELOPE_BYTES = 512;
/**
 * The Cyrillic script (core's `\p{Script=Cyrillic}`, Unicode 15) as plain ranges: a property escape makes the engine
 * look its ranges up when it reads the pattern, and MAIN's whole start at document_start is ≤ 1 ms (§3.1).
 */
// eslint-disable-next-line no-misleading-character-class -- code points, the script's combining letters among them, tested one by one
export const CYRILLIC = /[\u0400-\u0484\u0487-\u052F\u1C80-\u1C88\u1D2B\u1D78\u2DE0-\u2DFF\uA640-\uA69F\uFE2E\uFE2F\u{1E030}-\u{1E06D}\u{1E08F}]/u;

/** UTF-8 bytes of a JSON text (its lone surrogates are escapes already). */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < text.length) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/** The record lies in the chat's continuous interval: at or after its floor, once it has one. */
const inside = (chat: Chat, i: number): boolean => !chat.ever || chat.floor === null || compareIds(chat.ids[i] as string, chat.floor) >= 0;
const deleted = (chat: Chat, i: number): boolean => ((chat.bits[i] as number) & DELETED) !== 0;
const side = (chat: Chat, i: number): 'fan' | 'model' => ((chat.bits[i] as number) & FAN ? 'fan' : 'model');

export interface Views {
  /** The group as `fx.chat` gives it; null — MAIN knows neither its messages nor its members. */
  chat(groupId: string, routeEpoch: number): Plain | null;
  /** The generation snapshot (the header); `drained` — the deferred parse finished within its budget. */
  snapshot(request: SnapshotRequest, epochs: { readonly document: string; readonly socket: number; readonly route: number }, drained: boolean): Plain | null;
}

export function createViews(observation: Observation, identity: Identity, stringify: (value: unknown) => string): Views {
  const complete = (chat: Chat | undefined): chat is Chat => chat !== undefined && chat.complete && !observation.waiting(chat.id);

  /** The fan's script by the fan's texts MAIN holds (AI-087): Cyrillic in any — `cyrillic`; lines without — `other`. */
  const script = (chat: Chat | undefined): string => {
    let lines = false;
    for (let i = 0; chat?.texts && i < chat.ids.length; i += 1) {
      const text = chat.texts[i];
      if (text === undefined || side(chat, i) !== 'fan' || text.trim() === '') continue;
      if (CYRILLIC.test(text)) return SCRIPT_CYRILLIC;
      lines = true;
    }
    return lines ? SCRIPT_OTHER : UNKNOWN;
  };

  return {
    chat(groupId, routeEpoch) {
      const chat = observation.chat(groupId);
      if (chat === undefined && !identity.known(groupId)) return null;
      const newest = chat === undefined ? -1 : observation.newest(chat);
      let loaded = 0;
      for (let i = 0; chat !== undefined && i < chat.ids.length; i += 1) if (!deleted(chat, i)) loaded += 1;
      const whole = complete(chat);
      return {
        groupId,
        fanId: identity.fan(groupId),
        kind: identity.kind(groupId),
        dmAllowed: identity.dm(groupId),
        routeEpoch,
        window: {
          loaded,
          newestId: chat?.ids[newest] ?? null,
          newestAt: chat === undefined || newest < 0 ? null : isoOf(timeOf(chat, newest)),
          completeness: whole ? COMPLETE : UNKNOWN,
          startProven: whole && chat.start,
          fanScript: script(chat),
        },
      };
    },

    snapshot(request, epochs, drained) {
      const creatorId = identity.creator;
      const fanId = identity.fan(request.groupId);
      if (creatorId === null || fanId === null || fanId === creatorId) return null;
      const chat = observation.chat(request.groupId);
      const size = Math.min(CHECK_WINDOW_MAX, request.window);
      /** The window's records, oldest first. */
      const picks: number[] = [];
      let from = 0;
      if (chat !== undefined) {
        let i = chat.ids.length - 1;
        for (; i >= 0 && picks.length < size && inside(chat, i); i -= 1) if (!deleted(chat, i)) picks.push(i);
        picks.reverse();
        // The span of the window: from its oldest record when it is full, else from the observation's start.
        from = picks.length === size ? (picks[0] as number) : i + 1;
      }
      const window = picks.map((i) => ({ id: chat?.ids[i] as string, dir: side(chat as Chat, i) }));
      const deletedIds: string[] = [];
      for (let i = from; chat !== undefined && i < chat.ids.length; i += 1) if (deleted(chat, i)) deletedIds.push(chat.ids[i] as string);
      const gap = !drained ? WHY_PENDING_PARSE : chat === undefined || !chat.complete ? (chat?.why ?? WHY_NOT_CERTIFIED) : observation.waiting(chat.id) ? WHY_UNSEEN : null;

      const out: Plain = {
        feature: request.feature,
        identity: { creatorId, groupId: request.groupId, fanId },
        epochs: { document: epochs.document, socket: epochs.socket, route: epochs.route },
        completeness: gap === null ? COMPLETE : UNKNOWN,
        window,
        knownFanMessageIds: window.filter((entry) => entry.dir === 'fan').slice(-KNOWN_FAN_MAX).map((entry) => entry.id),
        deletedIds,
        truncated: false,
      };
      if (gap !== null) out['gap'] = gap;

      if (request.feature === FEATURE_HI) {
        if (gap === null && chat !== undefined && chat.start) {
          // The tab's proof: every message since the start of the conversation is in the ring (§5.6).
          let witness: string | null = null;
          let covered = 0;
          const automated: string[] = [];
          for (let i = 0; i < chat.ids.length; i += 1) {
            if (deleted(chat, i) || !inside(chat, i)) continue;
            witness ??= chat.ids[i] as string;
            covered += 1;
            if (observation.automated(chat, i)) automated.push(chat.ids[i] as string);
          }
          out['startProof'] = {
            v: 1,
            source: PROOF_TAB,
            groupId: request.groupId,
            startWitnessId: witness,
            coveredCount: covered,
            personalCount: covered - automated.length,
            automatedIds: automated.slice(-AUTOMATED_IDS_MAX),
          };
        }
        const avatar = identity.avatar(fanId);
        if (avatar !== null) out['fanAvatarUrl'] = avatar;
      }

      if (request.withText) {
        const tail: Plain[] = [];
        let truncated = false;
        for (const i of picks) {
          const c = chat as Chat;
          if (!((c.bits[i] as number) & TEXT)) continue;
          const text = c.texts?.[i];
          const sentAt = isoOf(timeOf(c, i));
          // A text dropped by the account, or a time the page did not give: the tail lacks it, and says so.
          if (text === undefined || sentAt === null) {
            truncated = true;
            continue;
          }
          tail.push({ platformMessageId: c.ids[i], direction: side(c, i), sentAt, text: text.length > TAIL_TEXT_MAX_CHARS ? text.slice(0, TAIL_TEXT_MAX_CHARS) : text });
        }
        out['tail'] = [];
        let bytes = utf8Bytes(stringify(out)) + ENVELOPE_BYTES;
        const sizes = tail.map((item) => utf8Bytes(stringify(item)) + 1);
        for (const one of sizes) bytes += one;
        let first = 0;
        for (; bytes > SNAPSHOT_MAX_BYTES && first < tail.length; first += 1) bytes -= sizes[first] as number;
        out['tail'] = tail.slice(first);
        out['truncated'] = truncated || first > 0;
      }
      return out;
    },
  };
}
