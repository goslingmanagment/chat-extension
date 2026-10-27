// What the page asks of Fansly's API, as one interface. The stand's own
// backend answers in the page (synthetic world, data.ts) after a set latency
// and journals each request under the path Fansly's client would ask for
// (fansly-web.md §4), with the handler it was made in. Over the fake Fansly
// (R20 P6b) the same interface is answered by real XHR requests
// (xhr-backend.ts, http.ts): Fansly's HttpClient creates its `XMLHttpRequest`
// at request time (main:107553-107560), so a backend MUST create and send each
// request synchronously inside the call — that is how a send stays inside the
// Enter keydown or the Send click (main:29012-29023).

import { newMediaId, newMessageId, type Account, type Message, type MessageAttachment, type ServerGroup, type World } from './data';
import { inHandler } from './events';
import { record } from './journal';
import type { ApiCall } from './protocol';

/** A group as `GET /group/<id>/` and the inbox carry it. */
export interface GroupDetail {
  readonly id: string;
  readonly partners: readonly Account[];
  readonly dmRulesUnmet: boolean;
  readonly status: 1 | 2 | 3 | 4;
  readonly unread: number;
  readonly lastMessage: Message | null;
}

export interface OutgoingMessage {
  readonly groupId: string;
  readonly content: string;
  readonly attachments: readonly MessageAttachment[];
  readonly createdAt: number;
}

export interface UploadFile {
  readonly name: string;
  readonly type: string;
  readonly size: number;
  /** The page's blob of the file, for the composer's tile of it (as Fansly shows the medium it made). */
  readonly url?: string;
}

/** A history page: the latest 25, or the 25 before a message id (oldest first). */
export interface HistoryPage {
  readonly messages: readonly Message[];
  /** Nothing older is left. */
  readonly complete: boolean;
}

export interface StandBackend {
  /** `GET /messaging/groups`: the inbox, `limit` groups from `offset`, newest first. */
  groups(offset: number, limit: number, done: (groups: readonly GroupDetail[]) => void): void;
  /** `GET /group/<id>/` — on every entry into a chat (main:74565 → :28372-28379). */
  group(groupId: string, done: (group: GroupDetail | null) => void): void;
  /** `GET /message?groupId=…&limit=25[&before=…]`. */
  history(groupId: string, before: string | null, done: (page: HistoryPage) => void): void;
  /** `POST /message`: created and sent synchronously in this call. */
  send(message: OutgoingMessage, done: (sent: Message | null) => void): void;
  /** `POST /message/ack`: the page marks a chat read when it opens it. */
  ack(groupId: string): void;
  /** `POST /message/typing`, at most every 3 s. */
  typing(groupId: string): void;
  /** `POST /account/media`: the uploaded files become account media before a send that carries them. */
  createMedia(files: readonly UploadFile[], done: (attachments: readonly MessageAttachment[]) => void): void;
  /** `GET /message/automated`: on every composer the page creates (main:55930, :54205). */
  automated(): void;
}

const HISTORY_PAGE = 25;

function detailOf(group: ServerGroup): GroupDetail {
  return { id: group.id, partners: [...group.partners], dmRulesUnmet: group.dmRulesUnmet, status: group.status, unread: group.unread, lastMessage: group.history.at(-1) ?? null };
}

/** The stand's own backend: the synthetic world, answered after `latency()` ms. */
export function createLocalBackend(world: World, latency: () => number): StandBackend {
  const call = (method: ApiCall['method'], path: string, detail: Record<string, unknown> = {}): void => {
    const entry: ApiCall = { method, path, during: inHandler() };
    record('api', { ...entry, ...detail });
  };
  const later = (answer: () => void): void => {
    setTimeout(answer, latency());
  };

  return {
    groups(offset, limit, done) {
      call('GET', `/api/v1/messaging/groups?sortOrder=1&flags=0&limit=${limit}&offset=${offset}&ngsw-bypass=true`);
      later(() => done(world.groups.slice(offset, offset + limit).map(detailOf)));
    },
    group(groupId, done) {
      call('GET', `/api/v1/group/${groupId}/?ngsw-bypass=true`);
      later(() => {
        const group = world.byId.get(groupId);
        done(group === undefined ? null : detailOf(group));
      });
    },
    history(groupId, before, done) {
      call('GET', `/api/v1/message?groupId=${groupId}${before === null ? '' : `&before=${before}`}&limit=${HISTORY_PAGE}&ngsw-bypass=true`);
      later(() => {
        const history = world.byId.get(groupId)?.history ?? [];
        const end = before === null ? history.length : history.findIndex((message) => message.id === before);
        const stop = end < 0 ? 0 : end;
        const start = Math.max(0, stop - HISTORY_PAGE);
        done({ messages: history.slice(start, stop), complete: start === 0 });
      });
    },
    send(message, done) {
      call('POST', '/api/v1/message?ngsw-bypass=true', { groupId: message.groupId, content: message.content, attachments: message.attachments.length });
      later(() => {
        const group = world.byId.get(message.groupId);
        if (group === undefined) {
          done(null);
          return;
        }
        const sent: Message = { id: newMessageId(world), groupId: group.id, senderId: world.creator.id, content: message.content, createdAt: Math.floor(Date.now() / 1000), attachments: message.attachments };
        group.history.push(sent);
        done(sent);
      });
    },
    ack(groupId) {
      call('POST', '/api/v1/message/ack?ngsw-bypass=true', { groupId });
      const group = world.byId.get(groupId);
      if (group !== undefined) group.unread = 0;
    },
    typing(groupId) {
      call('POST', '/api/v1/message/typing?ngsw-bypass=true', { groupId });
    },
    createMedia(files, done) {
      call('POST', '/api/v1/account/media?ngsw-bypass=true', { files: files.length });
      later(() => done(files.map(() => ({ contentId: newMediaId(world), contentType: 1 }))));
    },
    automated() {
      call('GET', '/api/v1/message/automated?ngsw-bypass=true');
    },
  };
}
