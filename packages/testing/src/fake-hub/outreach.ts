// «Рассылки» as the fake hub keeps them (hub docs/plans/2026-11-01-outreach-store/spec.md, `outreach-store-v1`): the
// page's outreaches, shared by its team — the list, one whole, a save (the last save wins a field; a fan whose send was
// claimed keeps its version), a fan's send (claimed once per fan of an outreach, again only after a proven refusal; a
// claim not reported within its ticket is unknown and never claimed again), and the fans written to in 72 hours.
// Nothing here sends anything. A scenario may seed a colleague's outreach (`outreachSeed`) and touches of a fan queue
// or «Онлайн» (`outreachTouches`); results (answered, bought) are the seed's, the stand has no archive for them.

import {
  type OutreachStoreFan,
  type OutreachStoreList,
  type OutreachStoreOutreach,
  type OutreachStoreSaveBody,
  type OutreachStoreSaved,
  type OutreachStoreSendAnswer,
  type OutreachStoreSendBody,
  type OutreachStoreSummary,
  type OutreachStoreTouches,
} from '@cg/contracts';

import { iso } from './clock';
import { type FakePage } from './config';
import { type OutreachPerson as Person, type OutreachSeed, type OutreachTouchSeed } from './types';

type Read<T> = { readonly ok: true; readonly body: T } | { readonly ok: false; readonly refusal: { readonly error: string; readonly reason?: string } };

const TICKET_MS = 120_000;
const TOUCH_MS = 72 * 3_600_000;
const KEEP_MS = 90 * 86_400_000;
const RECORD_MAX_MS = 30 * 86_400_000;

interface Send {
  state: 'sending' | 'sent' | 'uncertain' | 'failed';
  attemptId: string;
  by: Person;
  clickedAt: number;
  ticketUntil: number | null;
  sentAt: number | null;
  code: string | null;
  text: string | null;
  media: Record<string, unknown> | null;
  platformMessageId: string | null;
}

interface Fan {
  version: string | null;
  basis: string | null;
  versionAt: number | null;
  edit: string | null;
  editedBy: Person | null;
  editedAt: number | null;
  send: Send | null;
  /** The seed's results. */
  outcome: OutreachStoreFan['outcome'];
}

interface Outreach {
  readonly id: string;
  readonly pageLabel: string;
  readonly author: Person;
  readonly createdAt: number;
  updatedAt: number;
  updatedBy: Person;
  text: string;
  withMedia: boolean;
  settings: Record<string, unknown>;
  order: string[];
  readonly fans: Map<string, Fan>;
}

const state = (send: Send, now: number): Send['state'] => (send.state === 'sending' && send.ticketUntil !== null && send.ticketUntil <= now ? 'uncertain' : send.state);
const went = (send: Send | null, now: number): boolean => send !== null && state(send, now) !== 'failed';

const DOWN = { ok: false, refusal: { error: 'service_unavailable' } } as const;

export class OutreachModel {
  private readonly outreaches = new Map<string, Outreach>();
  private readonly touches = new Map<string, OutreachTouchSeed[]>();
  /** A scenario's «the hub does not answer»: every outreach route answers 503. */
  private down = false;

  setDown(down: boolean): void {
    this.down = down;
  }

  private person(person: Person, userId: number): { readonly name: string; readonly isMe: boolean } {
    return { name: person.name, isMe: person.id === userId };
  }

  private fanWire(fan: Fan, fanRef: string, userId: number, now: number): OutreachStoreFan {
    const send = fan.send;
    return {
      fanRef,
      version: fan.version,
      basis: fan.basis,
      versionAt: fan.versionAt === null ? null : iso(fan.versionAt),
      edit: fan.edit,
      editedBy: fan.editedBy === null ? null : this.person(fan.editedBy, userId),
      editedAt: fan.editedAt === null ? null : iso(fan.editedAt),
      send:
        send === null
          ? null
          : {
              state: state(send, now),
              attemptId: send.attemptId,
              by: this.person(send.by, userId),
              clickedAt: iso(send.clickedAt),
              ticketUntil: state(send, now) === 'sending' && send.ticketUntil !== null ? iso(send.ticketUntil) : null,
              sentAt: send.sentAt === null ? null : iso(send.sentAt),
              code: send.code,
              text: send.text,
              media: send.media,
              platformMessageId: send.platformMessageId,
              resolvedBy: null,
            },
      outcome: send !== null && state(send, now) === 'sent' ? fan.outcome : null,
    };
  }

  private wire(outreach: Outreach, userId: number, now: number): OutreachStoreOutreach {
    return {
      outreachId: outreach.id,
      author: this.person(outreach.author, userId),
      createdAt: iso(outreach.createdAt),
      updatedAt: iso(outreach.updatedAt),
      updatedBy: this.person(outreach.updatedBy, userId),
      text: outreach.text,
      withMedia: outreach.withMedia,
      settings: outreach.settings,
      order: [...outreach.order],
      fans: [...outreach.fans].filter(([, fan]) => fan.version !== null || fan.edit !== null || fan.send !== null).map(([fanRef, fan]) => this.fanWire(fan, fanRef, userId, now)),
      serverNow: iso(now),
    };
  }

  private of(page: FakePage, id: string): Outreach | null {
    const outreach = this.outreaches.get(id);
    return outreach === undefined || outreach.pageLabel !== page.pageLabel ? null : outreach;
  }

  list(page: FakePage, userId: number, now: number): Read<OutreachStoreList> {
    if (this.down) return DOWN;
    for (const [id, outreach] of this.outreaches) if (outreach.pageLabel === page.pageLabel && now - outreach.updatedAt > KEEP_MS) this.outreaches.delete(id);
    const outreaches: OutreachStoreSummary[] = [...this.outreaches.values()]
      .filter((outreach) => outreach.pageLabel === page.pageLabel)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 50)
      .map((outreach) => {
        const fans = [...outreach.fans.values()];
        const states = fans.map((fan) => (fan.send === null ? null : state(fan.send, now)));
        const sentFans = fans.filter((fan) => fan.send !== null && state(fan.send, now) === 'sent');
        const lastSent = sentFans.map((fan) => fan.send?.sentAt ?? 0).sort((a, b) => b - a)[0];
        return {
          outreachId: outreach.id,
          author: this.person(outreach.author, userId),
          createdAt: iso(outreach.createdAt),
          updatedAt: iso(outreach.updatedAt),
          updatedBy: this.person(outreach.updatedBy, userId),
          text: outreach.text.slice(0, 300),
          withMedia: outreach.withMedia,
          fans: outreach.order.length,
          written: fans.filter((fan) => fan.version !== null || fan.edit !== null).length,
          sent: states.filter((one) => one === 'sent').length,
          uncertain: states.filter((one) => one === 'uncertain').length,
          sending: states.filter((one) => one === 'sending').length,
          failed: states.filter((one) => one === 'failed').length,
          replied: sentFans.filter((fan) => fan.outcome?.replied !== null && fan.outcome?.replied !== undefined).length,
          bought: sentFans.filter((fan) => fan.outcome?.bought !== null && fan.outcome?.bought !== undefined).length,
          boughtMills: sentFans.reduce((sum, fan) => sum + (fan.outcome?.bought?.mills ?? 0), 0),
          lastSentAt: lastSent === undefined ? null : iso(lastSent),
        };
      });
    return { ok: true, body: { pageLabel: page.pageLabel, outreaches, serverNow: iso(now) } };
  }

  get(page: FakePage, userId: number, id: string, now: number): Read<OutreachStoreOutreach> {
    if (this.down) return DOWN;
    const outreach = this.of(page, id);
    return outreach === null ? { ok: false, refusal: { error: 'not_found' } } : { ok: true, body: this.wire(outreach, userId, now) };
  }

  save(page: FakePage, user: Person, id: string, body: OutreachStoreSaveBody, now: number): Read<OutreachStoreSaved> {
    if (this.down) return DOWN;
    const other = this.outreaches.get(id);
    if (other !== undefined && other.pageLabel !== page.pageLabel) return { ok: false, refusal: { error: 'conflict', reason: 'outreach_not_found' } };
    const created = body.createdAt === undefined ? null : Date.parse(body.createdAt);
    const outreach: Outreach = other ?? {
      id,
      pageLabel: page.pageLabel,
      author: user,
      createdAt: created !== null && !Number.isNaN(created) && created <= now && now - created <= RECORD_MAX_MS ? created : now,
      updatedAt: now,
      updatedBy: user,
      text: '',
      withMedia: false,
      settings: {},
      order: [],
      fans: new Map(),
    };
    this.outreaches.set(id, outreach);
    if (body.text !== undefined) outreach.text = body.text;
    if (body.withMedia !== undefined) outreach.withMedia = body.withMedia;
    if (body.settings !== undefined) outreach.settings = body.settings;
    if (body.order !== undefined) outreach.order = [...body.order];
    const kept: string[] = [];
    for (const change of body.fans ?? []) {
      const fan = outreach.fans.get(change.fanRef) ?? { version: null, basis: null, versionAt: null, edit: null, editedBy: null, editedAt: null, send: null, outcome: null };
      outreach.fans.set(change.fanRef, fan);
      if (fan.send !== null && state(fan.send, now) !== 'failed') {
        kept.push(change.fanRef);
        continue;
      }
      if (change.version !== undefined) {
        fan.version = change.version;
        fan.basis = change.version === null ? null : (change.basis ?? null);
        fan.versionAt = change.version === null ? null : now;
      }
      if (change.edit !== undefined) {
        fan.edit = change.edit;
        fan.editedBy = change.edit === null ? null : user;
        fan.editedAt = change.edit === null ? null : now;
      }
    }
    outreach.updatedAt = now;
    outreach.updatedBy = user;
    return { ok: true, body: { ...this.wire(outreach, user.id, now), kept } };
  }

  send(page: FakePage, user: Person, id: string, body: OutreachStoreSendBody, now: number): Read<OutreachStoreSendAnswer> {
    if (this.down) return DOWN;
    const outreach = this.of(page, id);
    if (outreach === null) return { ok: false, refusal: { error: 'conflict', reason: 'outreach_not_found' } };
    const fan = outreach.fans.get(body.fanRef) ?? { version: null, basis: null, versionAt: null, edit: null, editedBy: null, editedAt: null, send: null, outcome: null };
    outreach.fans.set(body.fanRef, fan);
    const answer = (outcome: string): Read<OutreachStoreSendAnswer> => ({ ok: true, body: { outcome, fan: this.fanWire(fan, body.fanRef, user.id, now), serverNow: iso(now) } });
    const own = fan.send !== null && fan.send.attemptId === body.attemptId;
    switch (body.action) {
      case 'claim': {
        if (went(fan.send, now)) return answer('taken');
        // Another outreach's send to the fan on its way right now.
        for (const other of this.outreaches.values()) {
          if (other === outreach || other.pageLabel !== page.pageLabel) continue;
          const send = other.fans.get(body.fanRef)?.send ?? null;
          if (send !== null && state(send, now) === 'sending') return answer('busy');
        }
        fan.send = { state: 'sending', attemptId: body.attemptId, by: user, clickedAt: now, ticketUntil: now + TICKET_MS, sentAt: null, code: null, text: body.text, media: body.media, platformMessageId: null };
        break;
      }
      case 'sent':
        if (!own || fan.send === null) return answer('not_yours');
        if (fan.send.state === 'sent') return answer('ok');
        if (fan.send.state === 'failed') return answer('not_yours');
        fan.send.state = 'sent';
        fan.send.sentAt = now;
        fan.send.ticketUntil = null;
        fan.send.platformMessageId = body.platformMessageId ?? null;
        break;
      case 'failed':
        if (!own || fan.send === null) return answer('not_yours');
        if (fan.send.state === 'failed') return answer('ok');
        if (fan.send.state === 'sent') return answer('not_yours');
        fan.send.state = 'failed';
        fan.send.code = body.code;
        fan.send.sentAt = now;
        fan.send.ticketUntil = null;
        break;
      case 'uncertain':
        if (!own || fan.send === null) return answer('not_yours');
        if (state(fan.send, now) === 'uncertain') return answer('ok');
        if (fan.send.state !== 'sending') return answer('not_yours');
        fan.send.state = 'uncertain';
        fan.send.ticketUntil = null;
        break;
      case 'record': {
        if (fan.send !== null && state(fan.send, now) !== 'failed') return answer(own ? 'ok' : 'taken');
        const clicked = Date.parse(body.clickedAt);
        if (Number.isNaN(clicked) || clicked > now + 60_000 || now - clicked > RECORD_MAX_MS) return { ok: false, refusal: { error: 'bad_request' } };
        const sentAt = body.sentAt === undefined ? null : Date.parse(body.sentAt);
        fan.send = { state: body.state, attemptId: body.attemptId, by: user, clickedAt: clicked, ticketUntil: null, sentAt: sentAt === null || Number.isNaN(sentAt) ? null : sentAt, code: null, text: body.text, media: body.media, platformMessageId: body.platformMessageId ?? null };
        break;
      }
    }
    outreach.updatedAt = now;
    outreach.updatedBy = user;
    return answer('ok');
  }

  touched(page: FakePage, userId: number, now: number): Read<OutreachStoreTouches> {
    if (this.down) return DOWN;
    const latest = new Map<string, OutreachStoreTouches['fans'][number]>();
    const put = (touch: OutreachStoreTouches['fans'][number], at: number): void => {
      const was = latest.get(touch.fanRef);
      if (now - at <= TOUCH_MS && (was === undefined || Date.parse(was.at) < at)) latest.set(touch.fanRef, touch);
    };
    for (const outreach of this.outreaches.values()) {
      if (outreach.pageLabel !== page.pageLabel) continue;
      for (const [fanRef, fan] of outreach.fans) {
        if (!went(fan.send, now) || fan.send === null) continue;
        const at = fan.send.sentAt ?? fan.send.clickedAt;
        put({ fanRef, at: iso(at), kind: 'outreach', by: this.person(fan.send.by, userId), outreachId: outreach.id }, at);
      }
    }
    for (const touch of this.touches.get(page.pageLabel) ?? []) {
      const at = now - touch.agoMin * 60_000;
      put({ fanRef: touch.fanRef, at: iso(at), kind: touch.kind, by: touch.by === null ? null : this.person(touch.by, userId), outreachId: null }, at);
    }
    return { ok: true, body: { pageLabel: page.pageLabel, hours: 72, fans: [...latest.values()], serverNow: iso(now) } };
  }

  /** A scenario's colleague outreach: its fans in order, versions written, some sent. */
  seed(page: FakePage, seed: OutreachSeed, now: number): void {
    const at = now - seed.agoMin * 60_000;
    const fans = new Map<string, Fan>();
    for (const fan of seed.fans) {
      const sent = fan.sent;
      const sentAt = sent === undefined ? null : now - sent.agoMin * 60_000;
      fans.set(fan.fanRef, {
        version: fan.version,
        basis: null,
        versionAt: at,
        edit: fan.edit ?? null,
        editedBy: fan.edit === undefined ? null : seed.author,
        editedAt: fan.edit === undefined ? null : at,
        send: sent === undefined || sentAt === null ? null : { state: 'sent', attemptId: `00000000-0000-4000-8000-${String(fans.size).padStart(12, '0')}`, by: sent.by ?? seed.author, clickedAt: sentAt, ticketUntil: null, sentAt, code: null, text: fan.version, media: null, platformMessageId: null },
        outcome:
          sent === undefined || sentAt === null
            ? null
            : { replied: sent.replied === undefined ? null : { at: iso(sentAt + 20 * 60_000), text: sent.replied }, bought: sent.boughtMills === undefined ? null : { mills: sent.boughtMills, at: iso(sentAt + 40 * 60_000) } },
      });
    }
    this.outreaches.set(seed.id, {
      id: seed.id,
      pageLabel: page.pageLabel,
      author: seed.author,
      createdAt: at,
      updatedAt: at,
      updatedBy: seed.author,
      text: seed.text,
      withMedia: seed.media !== undefined,
      // As a colleague's window saves it: the fans he picked, the default conditions, the offer's vault media.
      settings: { v: 1, textRevision: 0, textChangedAt: null, source: { kind: 'picked', fans: seed.fans.map((fan) => fan.fanRef) }, amountTyped: '1,000', unticked: [], items: [], picked: [], media: seed.media === undefined ? null : { items: seed.media.items, posts: 0, priceCents: seed.media.priceCents } },
      order: seed.fans.map((fan) => fan.fanRef),
      fans,
    });
  }

  seedTouches(page: FakePage, touches: readonly OutreachTouchSeed[]): void {
    this.touches.set(page.pageLabel, [...touches]);
  }

  reset(): void {
    this.outreaches.clear();
    this.touches.clear();
  }
}
