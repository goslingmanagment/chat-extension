// Who is who (docs/project-unite/architecture.md §5.7; FS-IDN-1, FS-IDN-3,
// FX-018), from the page's own answers and frames only — MAIN asks nothing:
// - the creator: `account.id` of the page's `GET /account/me` (the runtime
//   reads it; HF-1: equal to the hub page's external id);
// - a group: its members (`users[].userId`) and type (1 — a DM, 3 — a mass
//   send) from `GET /group/<id>/` and the inbox's `aggregationData.groups[]`
//   (`/messaging/groups`); a frame of members (4/6 added, 4/7 removed) changes
//   them. Exactly two members, the creator one of them: a direct chat, its fan
//   the other one; any other count — a group chat, no fan, no AI, no header slot
//   (FS-IDN-3). Members not known: neither. An answer without the members (the
//   `POST /group/<id>/` of a group chat answers `users` alone, and the table
//   does not take it) never lowers what is known (P3a);
// - the DM rules (`dmPermissionFlags`, `accountDmPermissionFlags`): may the
//   model write to the fan — Fansly's own `verifyNew`, as the old extension
//   ported it (fansly-chat/src/shared/fansly-dm-permissions.ts:53-70); false —
//   «only copy» (FS-DOCK-3); null — the answer carried no rules;
// - the fan's avatar: the address of the page's own account answers
//   (`aggregationData.accounts[]` of the inbox, `GET /account?ids=` of the
//   page's account cache) by the old extension's rule (fansly-chat/src/
//   shared/followers.ts:101-129: a variant ≤ 512 px wide first, the CDN
//   location, its signature folded into the query) and the hub's
//   (`fanslyAvatarUrlSchema`: https, a `*.fansly.com` host, ≤ 4096
//   characters). A string only: nobody here loads it (X37).
// Bounded: MAX_GROUPS groups and MAX_AVATARS avatars, the least recently
// touched forgotten first — a group whose chat the observation holds only
// when no other is left; both are in the memory account (memory.ts).

import { idOf, isPlain, type Plain } from '@cg/host-kit/main/check';

import type { Memory } from './memory';
import { AVATAR_MAX_CHARS, AVATAR_PATTERN, COST_GROUP, COST_MEMBER, COST_RECORD, COST_TEXT, KIND_DIRECT, KIND_GROUP, MAX_AVATARS, MAX_GROUPS } from './protocol';

export type Kind = typeof KIND_DIRECT | typeof KIND_GROUP;

interface Group {
  /** Member ids; null — not known yet. */
  members: string[] | null;
  type: number | null;
  /** Fansly's DM rules let the model write; null — not known. */
  dm: boolean | null;
  /**
   * The observation number of what it says: a member frame's own, an answer's `loadstart`. An answer asked before it
   * says nothing newer (a member added while it was in flight stays added, §5.6 merge order).
   */
  seen: number;
}

const MASS_SEND_GROUP = 3;
const SIGNATURE_KEYS = ['Key-Pair-Id', 'Policy', 'Signature'];

/** A finite number, or 0 (the rule's own reading of a missing amount). */
const amount = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/**
 * Fansly's `verifyNew` (main.2e6b96097a4bb73b.js, as fansly-chat/src/shared/fansly-dm-permissions.ts ports it): any
 * one rule set met is enough; a price is unmet unless paid already (no tip is ever attached); an unreadable price is
 * unmet. `rules` — `dmPermissionFlags`, `account` — `accountDmPermissionFlags`; the metadata are JSON strings.
 */
export function dmAllowed(rules: readonly unknown[], account: unknown, parse: (text: string) => unknown): boolean {
  const read = (value: unknown): Plain | null => {
    if (typeof value !== 'string') return null;
    try {
      const parsed = parse(value);
      return isPlain(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };
  const have = read(isPlain(account) ? account['metadata'] : null) ?? {};
  const missing = (rule: unknown, had: unknown, field: string): number => {
    const needed = amount(read(rule)?.['minAmount']);
    return needed ? needed - amount(read(had)?.[field]) : 0;
  };
  for (const rule of rules) {
    const r = isPlain(rule) ? rule : {};
    const flags = amount(r['flags']);
    const meta = read(r['metadata']) ?? {};
    let open = flags & ~amount(r['verificationFlags']);
    open = flags & 8 && missing(meta['8'], have['8'], 'totalSent') > 0 ? open | 8 : open & ~8;
    open = flags & 32 && missing(meta['32'], have['32'], 'totalPurchased') > 0 ? open | 32 : open & ~32;
    if (flags & 1) {
      const price = read(meta['1'])?.['price'];
      const unpaid = price === null ? false : typeof price !== 'number' || !Number.isFinite(price) || amount(read(have['1'])?.['price']) < price;
      open = unpaid ? open | 1 : open & ~1;
    } else open &= ~1;
    if (!open) return true;
  }
  return rules.length === 0;
}

/** The avatar's address by the old extension's rule and the hub's; null — none fit to send. */
export function avatarOf(account: Plain, Url: typeof URL): string | null {
  const avatar = account['avatar'];
  if (!isPlain(avatar)) return null;
  const variants = (Array.isArray(avatar['variants']) ? (avatar['variants'] as unknown[]) : [])
    .filter((v): v is Plain => isPlain(v) && amount(v['width']) > 0 && amount(v['width']) <= 512)
    .sort((a, b) => amount(b['width']) - amount(a['width']));
  for (const candidate of [...variants, avatar]) {
    const locations = candidate['locations'];
    const first: unknown = Array.isArray(locations) ? (locations as unknown[])[0] : null;
    const location = isPlain(first) ? first['location'] : null;
    const raw = typeof location === 'string' && location !== '' ? location : candidate['location'];
    if (typeof raw !== 'string' || raw === '') continue;
    try {
      const url = new Url(raw);
      if (url.protocol !== 'https:' || !/^[-a-z0-9]+\.fansly\.com$/i.test(url.hostname) || url.username || url.password || url.port) continue;
      const metadata = isPlain(first) ? first['metadata'] : null;
      if (isPlain(metadata)) for (const key of SIGNATURE_KEYS) if (typeof metadata[key] === 'string') url.searchParams.set(key, metadata[key]);
      const href = url.href;
      if (href.length <= AVATAR_MAX_CHARS && AVATAR_PATTERN.test(href)) return href;
    } catch {
      // A broken address: the next candidate, or none.
    }
  }
  return null;
}

export interface Identity {
  creator: string | null;
  /** A group of an answer asked at observation `seen` (`/group/<id>/`, `aggregationData.groups[]`): its id, or null — not a group. */
  readGroup(value: unknown, seen: number): string | null;
  /** An account of an answer: its avatar, if it has one fit to send. */
  readAccount(value: unknown): void;
  /** A member added (4/6) or removed (4/7) at observation `seen`; true — the group's fan or kind changed. */
  member(groupId: string, userId: string | null, added: boolean, seen: number): boolean;
  groupForFan(fanId: string): string | null;
  known(groupId: string): boolean;
  kind(groupId: string): Kind | null;
  fan(groupId: string): string | null;
  dm(groupId: string): boolean | null;
  avatar(fanId: string): string | null;
  /** Forgets the least recently touched group but `keep`; false — none to forget. */
  evict(keep: string | null): boolean;
  /** Forgets the least recently seen avatar; false — none left. */
  evictAvatar(): boolean;
}

/**
 * `held` — the observation still holds this chat (or it is the focused one): its group is forgotten only when no other
 * is left to forget.
 */
export function createIdentity(memory: Memory, parse: (text: string) => unknown, Url: typeof URL, held: (groupId: string) => boolean = () => false): Identity {
  const groups = new Map<string, Group>();
  const avatars = new Map<string, string>();
  const groupCost = (group: Group): number => COST_GROUP + COST_MEMBER * (group.members?.length ?? 0);
  const avatarCost = (url: string): number => COST_RECORD + COST_TEXT + 2 * url.length;

  /** The group, touched: last in the map's order. */
  const take = (id: string): Group | undefined => {
    const group = groups.get(id);
    if (group !== undefined) {
      groups.delete(id);
      groups.set(id, group);
    }
    return group;
  };

  /** The group, touched, or a new one known by nothing yet. */
  const ensure = (id: string): Group => {
    let group = take(id);
    if (group === undefined) {
      group = { members: null, type: null, dm: null, seen: 0 };
      groups.set(id, group);
      memory.groups += groupCost(group);
      if (groups.size > MAX_GROUPS) identity.evict(id);
    }
    return group;
  };

  const forgetAvatar = (id: string, url: string): void => {
    avatars.delete(id);
    memory.groups -= avatarCost(url);
  };

  const identity: Identity = {
    creator: null,
    readGroup(value, seen) {
      if (!isPlain(value)) return null;
      const id = idOf(value['id']);
      if (id === null) return null;
      const group = ensure(id);
      const users = value['users'];
      let members: string[] | null = null;
      if (Array.isArray(users)) {
        members = [];
        for (const user of users as unknown[]) {
          const userId = isPlain(user) ? idOf(user['userId']) : null;
          if (userId !== null && !members.includes(userId)) members.push(userId);
        }
      }
      const type = typeof value['type'] === 'number' ? value['type'] : null;
      memory.groups -= groupCost(group);
      if (seen < group.seen) {
        // Asked before the members last changed: it may say what they were. A group chat it shows is safe to take — a
        // DM it shows is not, and the change since stands (or stays unknown) until an answer asked after it.
        if (members !== null && (members.length !== 2 || type === MASS_SEND_GROUP)) {
          group.members = members;
          group.type = type ?? group.type;
        }
        memory.groups += groupCost(group);
        return id;
      }
      group.seen = seen;
      if (members !== null) group.members = members;
      if (type !== null) group.type = type;
      const rules = value['dmPermissionFlags'];
      if (Array.isArray(rules)) group.dm = dmAllowed(rules as unknown[], value['accountDmPermissionFlags'], parse);
      memory.groups += groupCost(group);
      return id;
    },
    readAccount(value) {
      if (!isPlain(value)) return;
      const id = idOf(value['id']);
      const url = id === null || id === identity.creator ? null : avatarOf(value, Url);
      if (id === null || url === null) return;
      const old = avatars.get(id);
      if (old !== undefined) forgetAvatar(id, old);
      avatars.set(id, url);
      memory.groups += avatarCost(url);
      if (avatars.size > MAX_AVATARS) identity.evictAvatar();
    },
    member(groupId, userId, added, seen) {
      // A group the page never showed us is remembered by the frame alone: an answer asked before it cannot undo it.
      const group = ensure(groupId);
      group.seen = seen;
      const before = `${identity.kind(groupId)}/${identity.fan(groupId)}`;
      memory.groups -= groupCost(group);
      // A change that names nobody (`4/8`, a member without its id): the members are not known any more.
      if (userId === null) group.members = null;
      else if (group.members !== null) group.members = added ? (group.members.includes(userId) ? group.members : [...group.members, userId]) : group.members.filter((id) => id !== userId);
      memory.groups += groupCost(group);
      return before !== `${identity.kind(groupId)}/${identity.fan(groupId)}`;
    },
    groupForFan(fanId) {
      for (const groupId of groups.keys()) if (identity.fan(groupId) === fanId) return groupId;
      return null;
    },
    known: (groupId) => groups.has(groupId),
    kind(groupId) {
      const members = groups.get(groupId)?.members ?? null;
      const creator = identity.creator;
      if (members === null || creator === null) return null;
      return members.length === 2 && members.includes(creator) && groups.get(groupId)?.type !== MASS_SEND_GROUP ? KIND_DIRECT : KIND_GROUP;
    },
    fan(groupId) {
      if (identity.kind(groupId) !== KIND_DIRECT) return null;
      return groups.get(groupId)?.members?.find((id) => id !== identity.creator) ?? null;
    },
    dm: (groupId) => groups.get(groupId)?.dm ?? null,
    avatar: (fanId) => avatars.get(fanId) ?? null,
    evictAvatar() {
      for (const [id, url] of avatars) {
        forgetAvatar(id, url);
        return true;
      }
      return false;
    },
    evict(keep) {
      // The least recently touched group no chat of the observation needs; else the least recently touched one.
      for (const spare of [true, false]) {
        for (const [id, group] of groups) {
          if (id === keep || (spare && held(id))) continue;
          groups.delete(id);
          memory.groups -= groupCost(group);
          return true;
        }
      }
      return false;
    },
  };
  return identity;
}
