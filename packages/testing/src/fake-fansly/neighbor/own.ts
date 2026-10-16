// FBuddy's own Fansly requests (S5 §2.4, §2.7, §2.8, §3.9, §3.10; §6.2 F, H):
// from its content script, with the page's token and the client headers it
// recorded from the page's requests REPLAYED (possibly stale); most addresses
// carry `ngsw-bypass=true`, not all. Its own `/account/me` gates its DOM work
// (a creator only); `/message/unread` every 10 s, then two `document.title`
// writes and a favicon swap; its fan profile saves a 12000 note «FBuddy Notes».
// A content script of an MV3 neighbour looks to the server and to our
// `webRequest` exactly like the page (P3a), so on the stand it asks with a
// token ISSUED TO IT (`session.issue`, fake-fansly/state.ts): the fake Fansly's
// journal names those calls `neighbour`, and a test can answer them 429 alone
// (`{op: 'api', rules: [{route, caller: 'neighbour', outcome}]}`). It never
// calls fbuddy.net: the organization's words come from the config, its message
// logs are only counted (isolated.ts).

import { FANSLY_CONTROL_HEADER, FANSLY_CONTROL_PATH, type FakeFanslyResult } from '../../../fixture-fansly/src/server-protocol';
import { FANSLY_API_PATH, NGSW_BYPASS, type WireAccount, type WireEnvelope, type WireNote, type WireUnreadPage } from '../../../fixture-fansly/src/wire';
import { FBUDDY_NOTE_TITLE, FBUDDY_NOTE_TYPE, type NeighborOwnRequest } from './protocol';

export interface OwnOptions {
  /** The fake Fansly's API origin. */
  readonly apiOrigin: string;
  /** A `fetch` the page's hooks never see (its content script's own). */
  readonly fetch: typeof fetch;
  /** The client headers it recorded from the page (replayed as they are). */
  readonly replayed: () => Readonly<Record<string, string>>;
}

interface Answer<T> {
  readonly status: number;
  readonly response: T | null;
}

const MAX_LOG = 2000;
const bypass = `${NGSW_BYPASS}=true`;

export class OwnRequests {
  readonly log: NeighborOwnRequest[] = [];
  private seq = 0;
  private token: string | null = null;

  constructor(private readonly options: OwnOptions) {}

  private async issue(): Promise<string | null> {
    const { apiOrigin, fetch } = this.options;
    try {
      const response = await fetch(`${apiOrigin}${FANSLY_CONTROL_PATH}`, {
        method: 'POST',
        headers: { [FANSLY_CONTROL_HEADER]: '1', 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'session', issue: 'neighbour' }),
      });
      const result = (await response.json()) as FakeFanslyResult;
      return result.token ?? null;
    } catch {
      return null;
    }
  }

  private async send<T>(method: 'GET' | 'POST', path: string, purpose: NeighborOwnRequest['purpose'], body?: unknown, retried = false): Promise<Answer<T>> {
    this.token ??= await this.issue();
    const headers: Record<string, string> = { ...this.options.replayed(), accept: 'application/json, text/plain, */*' };
    if (this.token !== null) headers['authorization'] = this.token;
    if (body !== undefined) headers['content-type'] = 'application/json';
    let status: number;
    let response: T | null = null;
    try {
      const answer = await this.options.fetch(`${this.options.apiOrigin}${FANSLY_API_PATH}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      status = answer.status;
      try {
        const envelope = JSON.parse(await answer.text()) as WireEnvelope<T>;
        response = envelope.success ? envelope.response : null;
      } catch {
        response = null;
      }
    } catch {
      status = 0;
    }
    this.seq += 1;
    this.log.push({ seq: this.seq, method, path, status, purpose });
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
    // Its token died with a reset of the fake Fansly: one more, once.
    if (status === 401 && !retried) {
      this.token = null;
      return this.send(method, path, purpose, body, true);
    }
    return { status, response };
  }

  /** Its own `/account/me`: the creator's id, or null (not a creator, or no answer). */
  async me(): Promise<string | null> {
    const answer = await this.send<{ readonly account: WireAccount }>('GET', `/account/me?${bypass}`, 'account');
    return answer.response?.account.id ?? null;
  }

  /** The unread poll: how many unread messages; null — no answer (a 429 included). */
  async unread(): Promise<number | null> {
    const answer = await this.send<WireUnreadPage>('GET', `/message/unread?limit=100&offset=0&${bypass}`, 'unread');
    return answer.response?.total ?? null;
  }

  /** The last request it made. */
  last(): NeighborOwnRequest | null {
    return this.log.at(-1) ?? null;
  }

  /**
   * Its fan profile saved (`autoAppendFanslyNotes`): the fan's «FBuddy Notes» 12000 note created or edited. These two
   * addresses go without `ngsw-bypass` — not all of FBuddy's do (S5 §3.9).
   */
  async writeNote(fanId: string, text: string): Promise<{ readonly id: string; readonly created: boolean } | null> {
    const read = await this.send<readonly WireAccount[]>('GET', `/account?ids=${fanId}`, 'note-read');
    const notes: readonly WireNote[] = read.response?.find((account) => account.id === fanId)?.notes ?? [];
    const mine = notes.find((note) => note.contentType === FBUDDY_NOTE_TYPE && note.title === FBUDDY_NOTE_TITLE);
    const body = { contentType: FBUDDY_NOTE_TYPE, contentId: fanId, title: FBUDDY_NOTE_TITLE, note: text };
    const written =
      mine === undefined
        ? await this.send<WireNote>('POST', '/notes', 'note-write', body)
        : await this.send<WireNote>('POST', '/notes/edit', 'note-write', { ...body, id: mine.id });
    // An edit's answer carries the title and the text alone, as on live Fansly: the note's id is the one it edited.
    return written.response === null ? null : { id: mine?.id ?? written.response.id, created: mine === undefined };
  }
}

/** The favicon it shows while there are unread messages (a canvas drawing on the site; a counted SVG here). */
export const unreadIcon = (count: number): string =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="#e5484d"/><text x="16" y="21" font-size="14" text-anchor="middle" fill="#fff">${count}</text></svg>`)}`;

/** F. The 10-s refresh after the poll: `document.title` twice (« FB» on, then off) and the favicon's `href`. */
export class TitleRefresh {
  writes = 0;
  favicons = 0;
  private originalIcon: string | null = null;

  constructor(private readonly doc: Document) {}

  run(unread: number): void {
    const base = this.doc.title.replace(/ FB$/, '');
    this.doc.title = `${base} FB`;
    this.doc.title = base;
    this.writes += 2;
    const link = this.doc.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (link === null) return;
    this.originalIcon ??= link.getAttribute('href') ?? '';
    const next = unread > 0 ? unreadIcon(unread) : this.originalIcon;
    if (link.getAttribute('href') === next) return;
    link.setAttribute('href', next);
    this.favicons += 1;
  }
}
