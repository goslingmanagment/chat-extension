// «Рассылки» on the hub (2026-11-01, the owner: «чтобы хранились рассылки у нас на сервере», the page's team works them
// together; hub docs/plans/2026-11-01-outreach-store/spec.md): the outreach as this browser keeps it (saved.ts) and as
// the hub holds it, one into the other; what a save sends; and what of the hub's copy the window takes. Pure.
//
// - The hub's copy is the outreach's; this browser keeps a copy and the save the hub has not taken yet (`pending`).
// - A save carries only what changed since the hub's copy the window last saw (`base`): the last save wins a field.
// - What the hub holds that the window did not change since `base` comes into the window (a colleague's version, words,
//   text); what the window changed stays and goes with its next save.
// - A send is never undone: the hub's send of a fan comes in when it got further (went, may have) than the window's —
//   the window's own send on its way excepted (the controller holds those).

import {
  OUTREACH_STORE_SAVE_FANS_MAX,
  type OutreachStoreFan,
  type OutreachStoreOutreach,
  type OutreachStoreSaveBody,
  type OutreachStoreSend,
} from '@cg/contracts/hub';

import { readSavedOutreach, sendRank, type SavedFan, type SavedMedia, type SavedOutcome, type SavedOutreach, type SavedSend } from './saved';

/** A hub's outcome is the hub's to read again: the window does not check it itself. */
export const HUB_OUTCOME_CHECKS = 99;

const ms = (at: string | null | undefined): number | null => {
  if (at === null || at === undefined) return null;
  const value = Date.parse(at);
  return Number.isNaN(value) ? null : value;
};
const isoOf = (value: number | null): string | null => (value === null ? null : new Date(value).toISOString());

/** The window's own state the hub stores as it is (`settings`) and never reads. */
export function settingsOf(saved: SavedOutreach): Record<string, unknown> {
  return {
    v: 1,
    textRevision: saved.textRevision,
    textChangedAt: saved.textChangedAt,
    source: saved.source,
    conditions: saved.conditions,
    amountTyped: saved.amountTyped,
    unticked: saved.unticked,
    items: saved.items,
    picked: saved.picked,
    media: saved.media,
  };
}

/** Who the outreach is for and its offer: what «Кому» and the offer show (the text's own marks aside). */
const audienceKey = (saved: SavedOutreach): string =>
  JSON.stringify([saved.source, saved.conditions, saved.amountTyped, saved.unticked, saved.items, saved.picked, saved.media]);

/** Whether the offer carries media (the list's «с медиа»). */
export const withMediaOf = (saved: Pick<SavedOutreach, 'media' | 'picked'>): boolean => saved.media !== null || saved.picked.length > 0;

function sendOfHub(send: OutreachStoreSend, now: number): Record<string, unknown> {
  // `sending` of anyone is on its way or unknown: never sendable here. An unknown state reads the same.
  const state = send.state === 'sent' ? 'sent' : send.state === 'failed' ? 'failed' : 'uncertain';
  const ticket = ms(send.ticketUntil);
  return {
    state,
    code: send.code,
    clickedAt: ms(send.clickedAt),
    at: state === 'sent' ? (ms(send.sentAt) ?? ms(send.clickedAt)) : state === 'failed' ? (ms(send.sentAt) ?? ms(send.clickedAt)) : null,
    text: send.text,
    media: send.media,
    attemptId: send.attemptId,
    claimed: true,
    reported: true,
    by: send.by.isMe ? null : send.by.name,
    messageId: send.platformMessageId,
    // A claim still on its ticket (someone sends right now): `uncertain` here until the hub says more.
    ...(send.state === 'sending' && ticket !== null && ticket > now ? { inFlight: true } : {}),
  };
}

function outcomeOfHub(fan: OutreachStoreFan): Record<string, unknown> | null {
  const outcome = fan.outcome;
  const send = fan.send;
  if (outcome === null || send === null) return null;
  const sentAt = ms(send.sentAt) ?? ms(send.clickedAt);
  if (sentAt === null || (outcome.replied === null && outcome.bought === null)) return null;
  return {
    sentAt,
    mills: null,
    paidIds: [],
    bought: outcome.bought === null ? null : { mills: outcome.bought.mills, at: outcome.bought.at },
    replied: outcome.replied,
    checks: HUB_OUTCOME_CHECKS,
  };
}

/**
 * The hub's copy as this browser keeps an outreach: its fans in the hub's order, those with a send out of it after
 * (a send is never lost); the names are the board's, the folding this browser's.
 */
export function fromHub(hub: OutreachStoreOutreach, owner: string, now: number, keep: { readonly names?: ReadonlyMap<string, string>; readonly folded?: boolean } = {}): SavedOutreach | null {
  const settings = hub.settings;
  const order = [...hub.order];
  for (const fan of hub.fans) if (fan.send !== null && fan.send.state !== 'failed' && !order.includes(fan.fanRef)) order.push(fan.fanRef);
  const raw = {
    ...settings,
    id: hub.outreachId,
    owner,
    createdAt: ms(hub.createdAt) ?? now,
    updatedAt: ms(hub.updatedAt) ?? now,
    text: hub.text,
    locked: order.length === 0 ? null : order,
    fans: hub.fans.map((fan) => ({
      fanRef: fan.fanRef,
      name: keep.names?.get(fan.fanRef) ?? null,
      version: fan.version,
      basis: fan.basis,
      versionAt: ms(fan.versionAt),
      edit: fan.edit,
      editedBy: fan.editedBy === null || fan.editedBy.isMe ? null : fan.editedBy.name,
      send: fan.send === null ? null : sendOfHub(fan.send, now),
      outcome: outcomeOfHub(fan),
    })),
    folded: keep.folded === true,
    author: hub.author.isMe ? null : hub.author.name,
    synced: true,
    pending: null,
  };
  return readSavedOutreach(raw);
}

/** One fan of the hub's answer to a send, as this browser keeps a fan; null — not one. */
export function fanFromHub(fan: OutreachStoreFan, now: number): SavedFan | null {
  const outreach = fromHub(
    { outreachId: '00000000-0000-4000-8000-000000000000', author: { name: '', isMe: true }, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), updatedBy: { name: '', isMe: true }, text: '', withMedia: false, settings: {}, order: [], fans: [fan], serverNow: new Date(now).toISOString() },
    '',
    now,
  );
  return outreach?.fans[0] ?? null;
}

/** The fans of a hub's copy whose send is on its way right now (a claim on its ticket). */
export function inFlightOf(hub: OutreachStoreOutreach, now: number): ReadonlySet<string> {
  const fans = new Set<string>();
  for (const fan of hub.fans) {
    const ticket = ms(fan.send?.ticketUntil ?? null);
    if (fan.send?.state === 'sending' && ticket !== null && ticket > now) fans.add(fan.fanRef);
  }
  return fans;
}

const fanMap = (saved: SavedOutreach | null): ReadonlyMap<string, SavedFan> => new Map((saved?.fans ?? []).map((fan) => [fan.fanRef, fan] as const));
const went = (send: SavedSend | null): boolean => send !== null && send.state !== 'failed';

/**
 * What a save of the window's outreach sends: what changed since the hub's copy it saw (`base`); everything when the hub
 * has none (`base` null — the first save, or the hub's copy is not known here). null — nothing to send.
 */
export function patchOf(base: SavedOutreach | null, local: SavedOutreach): OutreachStoreSaveBody | null {
  const body: { -readonly [K in keyof OutreachStoreSaveBody]: OutreachStoreSaveBody[K] } = {};
  const fans: NonNullable<OutreachStoreSaveBody['fans']>[number][] = [];
  if (base === null) {
    body.createdAt = new Date(local.createdAt).toISOString();
    body.text = local.text;
    body.withMedia = withMediaOf(local);
    body.settings = settingsOf(local);
    body.order = [...(local.locked ?? [])];
  } else {
    if (local.text !== base.text) body.text = local.text;
    if (withMediaOf(local) !== withMediaOf(base)) body.withMedia = withMediaOf(local);
    if (JSON.stringify(settingsOf(local)) !== JSON.stringify(settingsOf(base))) body.settings = settingsOf(local);
    if (JSON.stringify(local.locked ?? []) !== JSON.stringify(base.locked ?? [])) body.order = [...(local.locked ?? [])];
  }
  const before = fanMap(base);
  const now = new Set<string>();
  for (const fan of local.fans) {
    now.add(fan.fanRef);
    // A fan whose send was claimed keeps its version at the hub: nothing to send for it.
    if (went(fan.send) && fan.send?.claimed === true) continue;
    const was = before.get(fan.fanRef);
    const change: { -readonly [K in keyof NonNullable<OutreachStoreSaveBody['fans']>[number]]: NonNullable<OutreachStoreSaveBody['fans']>[number][K] } = { fanRef: fan.fanRef };
    if (fan.version !== (was?.version ?? null) || (fan.version !== null && fan.basis !== (was?.basis ?? null))) {
      change.version = fan.version;
      if (fan.version !== null) change.basis = fan.basis ?? 'unknown';
    }
    if (fan.edit !== (was?.edit ?? null) && fan.editedBy === null) change.edit = fan.edit;
    if (Object.keys(change).length > 1) fans.push(change);
  }
  // A fan the window let go («Очистить») whose version the hub still holds: let go there too.
  for (const [fanRef, was] of before) {
    if (now.has(fanRef) || went(was.send)) continue;
    if (was.version !== null || was.edit !== null) fans.push({ fanRef, version: null, edit: null });
  }
  if (fans.length > 0) body.fans = fans;
  return Object.keys(body).length === 0 ? null : body;
}

/** A save in requests the hub takes: the outreach's fields with the first, at most OUTREACH_STORE_SAVE_FANS_MAX fans each. */
export function splitSave(body: OutreachStoreSaveBody): OutreachStoreSaveBody[] {
  const fans = body.fans ?? [];
  if (fans.length <= OUTREACH_STORE_SAVE_FANS_MAX) return [body];
  const { fans: _fans, ...head } = body;
  const parts: OutreachStoreSaveBody[] = [];
  for (let at = 0; at < fans.length; at += OUTREACH_STORE_SAVE_FANS_MAX) {
    const slice = fans.slice(at, at + OUTREACH_STORE_SAVE_FANS_MAX);
    parts.push(at === 0 ? { ...head, fans: slice } : { fans: slice });
  }
  return parts;
}

/** One fan of the hub's copy the window takes. */
export interface AdoptFan {
  readonly fanRef: string;
  /** The hub's version (null — let go there). */
  readonly version?: { readonly text: string | null; readonly basis: string | null; readonly at: number | null };
  /** The hub's words for the version (null — back to Fix's) and whose. */
  readonly edit?: { readonly text: string | null; readonly by: string | null };
  /** The hub's send, further than the window's. */
  readonly send?: SavedSend;
  readonly outcome?: SavedOutcome;
}

export interface AdoptPlan {
  /** The hub's text; null — the window's stays. */
  readonly text: { readonly text: string; readonly revision: number; readonly changedAt: number | null } | null;
  /** The hub's «Кому» and offer; null — the window's stay. */
  readonly audience: SavedOutreach | null;
  /** The hub's order of the fans; undefined — the window's stays. */
  readonly order: readonly string[] | null | undefined;
  readonly fans: readonly AdoptFan[];
  /** Whose outreach it is, as the hub says. */
  readonly author: string | null;
}

/** Whether the hub's outcome says more than the window's. */
function moreOutcome(local: SavedOutcome | null, remote: SavedOutcome | null): SavedOutcome | null {
  if (remote === null) return null;
  if (local === null) return remote;
  const replied = local.replied ?? remote.replied;
  const bought = local.bought ?? remote.bought;
  if (replied === local.replied && bought === local.bought) return null;
  return { ...local, replied, bought };
}

/**
 * What of the hub's copy (`remote`) the window takes: what the window did not change since the copy it saw last
 * (`base`; null — none seen: the window's word stands for everything but the sends and outcomes).
 */
export function adoptPlan(base: SavedOutreach | null, local: SavedOutreach, remote: SavedOutreach): AdoptPlan {
  const unchanged = <T>(read: (outreach: SavedOutreach) => T): boolean => base !== null && JSON.stringify(read(local)) === JSON.stringify(read(base));
  const moved = <T>(read: (outreach: SavedOutreach) => T): boolean => base === null || JSON.stringify(read(remote)) !== JSON.stringify(read(base));
  const text = unchanged((outreach) => outreach.text) && moved((outreach) => outreach.text) ? { text: remote.text, revision: remote.textRevision, changedAt: remote.textChangedAt } : null;
  const audience = unchanged(audienceKey) && moved(audienceKey) ? remote : null;
  const order = unchanged((outreach) => outreach.locked ?? []) && moved((outreach) => outreach.locked ?? []) ? remote.locked : undefined;
  const localFans = fanMap(local);
  const baseFans = fanMap(base);
  // Fans the hub's order brings into the window: their versions and words come with them, whatever the window saw.
  const joining = new Set(order === undefined || order === null ? [] : order.filter((fanRef) => !(local.locked ?? []).includes(fanRef)));
  const fans: AdoptFan[] = [];
  for (const fan of remote.fans) {
    const mine = localFans.get(fan.fanRef);
    const was = baseFans.get(fan.fanRef);
    const joins = joining.has(fan.fanRef);
    const adopt: { -readonly [K in keyof AdoptFan]: AdoptFan[K] } = { fanRef: fan.fanRef };
    if (fan.send !== null && sendRank(fan.send) > sendRank(mine?.send ?? null)) adopt.send = fan.send;
    const versionMoved = (fan.version ?? null) !== (was?.version ?? null) || (fan.basis ?? null) !== (was?.basis ?? null);
    if ((joins && fan.version !== null) || (base !== null && (mine?.version ?? null) === (was?.version ?? null) && versionMoved)) {
      adopt.version = { text: fan.version, basis: fan.basis, at: fan.versionAt };
    }
    if ((joins && fan.edit !== null) || (base !== null && (mine?.edit ?? null) === (was?.edit ?? null) && (fan.edit ?? null) !== (was?.edit ?? null))) adopt.edit = { text: fan.edit, by: fan.editedBy };
    const outcome = moreOutcome(mine?.outcome ?? null, fan.outcome);
    if (outcome !== null) adopt.outcome = outcome;
    if (Object.keys(adopt).length > 1) fans.push(adopt);
  }
  return { text, audience, order, fans, author: remote.author };
}

/** A send the hub is to be told of (`reported` false): the report its claim waits for, or the record of one never claimed. */
export function reportOf(fanRef: string, send: SavedSend): Record<string, unknown> | null {
  if (send.reported || send.attemptId === null) return null;
  if (send.claimed) {
    if (send.state === 'sent') return { action: 'sent', fanRef, attemptId: send.attemptId, ...(send.messageId === null ? {} : { platformMessageId: send.messageId }) };
    if (send.state === 'failed') return { action: 'failed', fanRef, attemptId: send.attemptId, code: send.code ?? 'CG-SEND-REJECTED' };
    return { action: 'uncertain', fanRef, attemptId: send.attemptId };
  }
  // One that went while the hub did not answer: recorded (a refused one never claimed is nothing to the hub).
  if (send.state === 'failed' || send.text === null || send.text.trim() === '' || send.clickedAt === null) return null;
  return {
    action: 'record',
    fanRef,
    attemptId: send.attemptId,
    state: send.state,
    clickedAt: isoOf(send.clickedAt),
    ...(send.state === 'sent' && send.at !== null ? { sentAt: isoOf(send.at) } : {}),
    text: send.text,
    media: mediaWire(send.media),
    ...(send.messageId === null ? {} : { platformMessageId: send.messageId }),
  };
}

/** The media of a send as the hub keeps them for the client (opaque there). */
export const mediaWire = (media: SavedMedia | null): Record<string, unknown> | null => (media === null ? null : { items: media.items, posts: media.posts, priceCents: media.priceCents });
