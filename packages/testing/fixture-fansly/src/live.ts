// The stand page over the fake Fansly (R20 P6b): its start and what the
// socket's events do to it, as Fansly's client does (S2 Q1, fansly-web.md §4–§5).
// - Start (main:25932-25975): `GET /account/me` first (again after 0.5, 1, 2 s
//   on a failure, never after a 401); in the handler of its answer the socket
//   is created and the unread messages are asked for; then the router makes
//   its first navigation. So the route's first request for the open chat's
//   fresh end usually starts BEFORE the socket's `t: 1`, and `t: 1` brings a
//   second one (S2 Q1.7).
// - `t: 1` (every one — a new socket verifies again) and a return to the tab
//   after more than 30 s: every group's «latest page is in» mark is dropped
//   and the open chat's fresh end is asked again (main:28595-28603, :28684-28687).
// - Events (`handleServiceEvent`, main:28662-28682): `5/1` a message — dropped
//   when older than 180 s by the page's clock, a `type 3` of somebody else
//   skipped, a group the page does not know asked for by `GET /group/<id>/`,
//   and a fan's message marked delivered (or read, when its chat is open and
//   the page has the focus) through the page's ack queue (main:29054-29071);
//   `5/10` a deletion, with the cascade of a `type 3` parent; `4/2` (and `5/2`)
//   receipts; `5/22` typing; `4/6`–`4/8` members and new groups; `3/2` a follow.
// The stand's own controls reach the server through `command`: a control
// request, marked as one, never an API call of the page.

import type { StandBackend } from './backend';
import { FanslyHttp } from './http';
import { record } from './journal';
import type { SocketView } from './protocol';
import { FANSLY_CONTROL_HEADER, FANSLY_CONTROL_PATH, type FakeFanslyCommand, type FakeFanslyResult } from './server-protocol';
import { EventService } from './socket';
import type { GroupService } from './store';
import { EVENT, SERVICE, type WireAckCommand, type WireGroupUser, type WireMessage } from './wire';
import { XhrBackend, toMessage } from './xhr-backend';

/** Where the fake Fansly is, as the stand server told the page (server-protocol.ts FANSLY_SERVER_META). */
export interface ServerConfig {
  readonly apiOrigin: string;
  readonly socketUrl: string;
  readonly token: string;
}

export interface LiveOptions {
  /** Milliseconds between socket pings; 20–25 s at random when absent, as on the site. */
  readonly pingInterval?: number;
  /** Milliseconds the page collects its marks before sending them; 1–3 s at random when absent. */
  readonly ackDelay?: number;
}

const DISCARD_AFTER_MS = 180_000;
const REFETCH_AFTER_HIDDEN_MS = 30_000;
const randomBetween = (min: number, max: number): number => Math.floor(Math.random() * (max - min + 1)) + min;

export class LiveSession {
  readonly xhr: XhrBackend;
  loggedOut = false;
  private readonly http: FanslyHttp;
  private readonly events: EventService;
  private store: GroupService | null = null;
  private hiddenAt = 0;
  private readonly onVisibility = (): void => {
    if (document.hidden) this.hiddenAt = Date.now();
    else if (this.hiddenAt > 0) this.cameBack(Date.now() - this.hiddenAt);
  };

  constructor(
    private readonly config: ServerConfig,
    options: LiveOptions = {},
  ) {
    const ackDelay = options.ackDelay;
    this.http = new FanslyHttp(config);
    this.xhr = new XhrBackend({ http: this.http, ackDelay: () => ackDelay ?? randomBetween(1000, 3000) });
    this.events = new EventService({
      url: config.socketUrl,
      token: config.token,
      pingInterval: options.pingInterval ?? randomBetween(20_000, 25_000),
      onServiceEvent: (serviceId, event) => this.onServiceEvent(serviceId, event),
      onSessionVerified: () => this.store?.resetFetched(),
      onUnauthorized: () => this.logOut('socket'),
    });
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  get backend(): StandBackend {
    return this.xhr;
  }

  attach(store: GroupService): void {
    this.store = store;
    this.xhr.onGroup = (detail) => store.patch(detail.id, { partners: detail.partners, dmRulesUnmet: detail.dmRulesUnmet, status: detail.status });
    this.xhr.onUnread = () => store.refreshUnread((groupId) => this.xhr.unreadOf(groupId));
  }

  /** `verifyAuthRetry`, then the socket and the unread messages; `ready` runs when the router may make its first navigation. */
  start(ready: () => void): void {
    const startedAt = Date.now();
    let tries = 0;
    let wait = 500;
    const attempt = (): void => {
      this.xhr.me((account, unauthorized) => {
        if (account === null) {
          if (tries >= 3 || Date.now() - startedAt > 5000 || unauthorized) {
            this.logOut('account');
            ready();
            return;
          }
          tries += 1;
          setTimeout(() => {
            wait *= 2;
            attempt();
          }, wait);
          return;
        }
        if (this.store !== null) this.store.creator = account;
        this.events.connect();
        this.xhr.readUnread();
        ready();
      });
    };
    attempt();
  }

  private logOut(by: 'account' | 'socket'): void {
    if (this.loggedOut) return;
    this.loggedOut = true;
    record('logged-out', { by });
  }

  private onServiceEvent(serviceId: number, event: Readonly<Record<string, unknown>>): void {
    const store = this.store;
    if (store === null) return;
    const type = event['type'];
    if (serviceId === SERVICE.message) {
      if (type === EVENT.message.created) this.onMessage(store, event['message'] as WireMessage);
      else if (type === EVENT.message.deleted) {
        const deleted = event['message'] as WireMessage;
        store.remove(deleted.id);
        if (deleted.type === 3) store.removeCorrelated(deleted.id);
      } else if (type === EVENT.message.ack) this.onAcks(store, (event['messageAckEvent'] as { ackCommands?: WireAckCommand[] } | undefined)?.ackCommands ?? []);
      else if (type === EVENT.message.typing) {
        const typing = event['typingAnnounceEvent'] as { groupId: string; accountId: string };
        store.typing(typing.groupId, typing.accountId);
      }
    } else if (serviceId === SERVICE.group) {
      if (type === EVENT.group.ack) this.onAcks(store, [event['ackCommand'] as WireAckCommand]);
      else if (type === EVENT.group.userAdded || type === EVENT.group.userRemoved) {
        const user = event['groupUser'] as WireGroupUser;
        const detail = this.xhr.setGroupUser(user.groupId, user.userId, type === EVENT.group.userAdded);
        // A group the page does not know is asked for; a known one changes in place, no request (main:29157-29169).
        if (detail === null) store.fetchGroup(user.groupId);
        else store.patch(detail.id, { partners: detail.partners, dmRulesUnmet: detail.dmRulesUnmet, status: detail.status });
      } else if (type === EVENT.group.created) store.fetchGroup(String(event['id']));
    } else if (serviceId === SERVICE.follower) {
      const follow = event['follow'] as { id: string; followerId: string } | undefined;
      if (follow !== undefined) record(type === EVENT.follower.followed ? 'follow' : 'unfollow', { id: follow.id, followerId: follow.followerId });
    }
  }

  private onMessage(store: GroupService, wire: WireMessage): void {
    if (wire.createdAt > 0 && Date.now() - wire.createdAt * 1000 > DISCARD_AFTER_MS) {
      record('socket-message-discarded', { id: wire.id });
      return;
    }
    const own = wire.senderId === store.creator.id;
    if (wire.type === 3 && !own) return;
    const open = store.activeGroupId === wire.groupId && document.hasFocus();
    if (store.getGroup(wire.groupId) === null) {
      // `addGroupMessage`: an own automated message of an unknown group is skipped; any other makes the page ask for the group.
      if (!(wire.type === 2 && own)) store.fetchGroup(wire.groupId);
    } else {
      store.receive(toMessage(wire));
    }
    if (own) return;
    if (open) {
      this.xhr.ackMessage(3, wire.id);
    } else {
      this.xhr.noteUnread(wire.groupId, wire.id);
      this.xhr.ackMessage(1, wire.id);
    }
  }

  /** Receipts (main:29073-29118): the account's own «read» clears its unread marks; a partner's is a state of the message. */
  private onAcks(store: GroupService, commands: readonly WireAckCommand[]): void {
    for (const command of commands) {
      if (command.userId !== store.creator.id) {
        record('receipt', { userId: command.userId, receipt: command.type, messages: command.messageIds.length });
        continue;
      }
      if (command.type === 2 || command.type === 3) this.xhr.clearUnread(command.messageIds);
      if (command.type === 4) {
        for (const id of command.messageIds) {
          const message = store.messageById(id);
          if (message !== null) this.xhr.noteUnread(message.groupId, id);
        }
      }
      store.refreshUnread((groupId) => this.xhr.unreadOf(groupId));
    }
  }

  /** A message-like notification: the page asks for its messages by id and keeps them in its cache only (main:72183-72188). */
  notify(messageIds: readonly string[]): void {
    this.xhr.messagesByIds(messageIds, (messages) => record('notification-messages', { ids: messages.map((message) => message.id) }));
  }

  /** The tab is visible again after `hiddenMs` (main:28595-28603, :61532). */
  cameBack(hiddenMs: number): void {
    record('came-back', { hiddenMs });
    if (hiddenMs > REFETCH_AFTER_HIDDEN_MS && !this.loggedOut) {
      this.xhr.readUnread();
      this.store?.resetFetched();
    }
    if (hiddenMs > 1000) this.events.assertConnection();
  }

  socket(): SocketView {
    return this.events.view();
  }

  /**
   * The page has settled: its socket is verified, none of its requests is in flight, its unread reading is over and
   * no read mark waits or is going out. The stand's own signal for tests (protocol.ts `idle`), not Fansly's.
   */
  idle(): boolean {
    return (this.loggedOut || this.events.view().state === 'connected') && this.http.pending === 0 && !this.xhr.busy;
  }

  /** A command of the stand to the fake Fansly: a control request, journaled there as `control`. */
  async command(command: FakeFanslyCommand): Promise<FakeFanslyResult> {
    const response = await fetch(`${this.config.apiOrigin}${FANSLY_CONTROL_PATH}`, { method: 'POST', headers: { [FANSLY_CONTROL_HEADER]: '1', 'content-type': 'application/json' }, body: JSON.stringify(command) });
    if (!response.ok) throw new Error(`fake Fansly control: HTTP ${response.status}`);
    return (await response.json()) as FakeFanslyResult;
  }

  destroy(): void {
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.events.destroy();
    this.xhr.stop();
  }
}
