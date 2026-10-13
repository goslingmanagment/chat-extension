// What the fake Fansly's API, socket and control share: the world, the journal,
// the session tokens and what a test scripted (API outcomes, the send's echo,
// the socket's manners). `reset` puts all of it back but the journal and the
// page's token: a page that is open keeps its session.

import { randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';

import type { ApiRule, FanslyCaller, SendEcho } from '../../fixture-fansly/src/server-protocol';
import { FanslyWorld } from './data';
import { FanslyJournal, type FanslyRoute } from './journal';

/** How long after the page's verify request the server answers `t: 1`, unless a test says otherwise (see index.ts). */
export const DEFAULT_VERIFY_DELAY_MS = 100;

export interface SocketSettings {
  /** Answer the page's `"p"` with `t: 2`. Off: the page resets its socket after 1.2 ping intervals (main:27485-27495). */
  pong: boolean;
  /** Answer the page's verify request with `t: 1`. */
  verify: boolean;
  verifyDelayMs: number;
  /** The next connections to hold without ever opening them. */
  stall: number;
}

export interface SendSettings {
  echo: SendEcho;
  receiptDelayMs: number;
  echoDelayMs: number;
}

interface PendingRule {
  readonly rule: ApiRule;
  left: number;
}

export class FanslyState {
  world = new FanslyWorld();
  readonly journal = new FanslyJournal();
  /** The stand page's origin: whose calls are the page's, and who CORS lets in. Known once the stand listens. */
  pageOrigin = '';
  /** `localhost:<port>` of the API and of the socket: the only names they answer under. */
  apiHost = '';
  socketHost = '';
  /** The page's session token (synthetic, new on every start). */
  readonly token = `stand-session-${randomBytes(12).toString('hex')}`;
  /** Tokens issued for someone else (`session.issue`). */
  readonly labelled = new Map<string, 'neighbour'>();
  expired = false;
  socket: SocketSettings = { pong: true, verify: true, verifyDelayMs: DEFAULT_VERIFY_DELAY_MS, stall: 0 };
  send: SendSettings = { echo: 'after', receiptDelayMs: 0, echoDelayMs: 0 };
  /** Answers held open by a `hang` outcome. */
  readonly hanging = new Set<ServerResponse>();
  private rules: PendingRule[] = [];

  /** Whether an `authorization` value is a live session. */
  isLive(token: string | undefined): boolean {
    if (token === undefined) return false;
    if (this.labelled.has(token)) return true;
    return token === this.token && !this.expired;
  }

  labelOf(token: string | undefined): 'neighbour' | null {
    return token === undefined ? null : (this.labelled.get(token) ?? null);
  }

  issue(label: 'neighbour'): string {
    const token = `stand-${label}-${randomBytes(12).toString('hex')}`;
    this.labelled.set(token, label);
    return token;
  }

  script(rules: readonly ApiRule[]): void {
    for (const rule of rules) this.rules.push({ rule, left: rule.times ?? Number.POSITIVE_INFINITY });
  }

  /** The first scripted rule that matches the call, used up by one. */
  takeRule(route: FanslyRoute | null, caller: FanslyCaller): ApiRule | null {
    const found = this.rules.find((pending) => (pending.rule.route === '*' || pending.rule.route === route) && (pending.rule.caller === undefined || pending.rule.caller === caller));
    if (found === undefined) return null;
    found.left -= 1;
    if (found.left <= 0) this.rules = this.rules.filter((pending) => pending !== found);
    return found.rule;
  }

  get pendingRules(): number {
    return this.rules.length;
  }

  releaseHanging(): void {
    for (const response of this.hanging) response.destroy();
    this.hanging.clear();
  }

  reset(): void {
    this.world = new FanslyWorld();
    this.labelled.clear();
    this.expired = false;
    this.socket = { pong: true, verify: true, verifyDelayMs: DEFAULT_VERIFY_DELAY_MS, stall: 0 };
    this.send = { echo: 'after', receiptDelayMs: 0, echoDelayMs: 0 };
    this.rules = [];
    this.releaseHanging();
  }
}
