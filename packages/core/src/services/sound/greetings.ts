// The greeting reminder (2026-10-24): a fan of «Новые» nobody greeted ten
// minutes after subscribing is a toast «Ждёт приветствия · {фан}» with «Hi»
// in the ChatSpace tab that works under the fan's creator now. It reads the
// rows the subscriber poll reads (once a minute) and the ones a tab reads for
// its own open window: no request of its own. Which rows are due is the
// domain's (`dueGreetings`); here — once per subscription event, kept in
// storage.session so an event page that unloads does not remind again, and
// one tab: the one the person looks at, else the last that reported. A page
// nobody works under now is reminded of with the next poll that finds a tab.
// It sends nothing and starts nothing: «Hi» is the person's click.

import { type AudienceNewPage } from '@cg/contracts/hub';
import { hostAccountKeyOf } from '@cg/contracts/settings';

import { GREET_REMINDED_MAX, dueGreetings } from '../../domain/newcomers/remind';
import { NO_LOG, type IdSource, type KeyValueStore, type LogSink, type TabEventSink } from '../ports';
import { type PresenceService } from '../presence';
import { type SubscriberPage } from './subscribers';

export const GREET_SESSION_KEY = 'greet.reminded';

export interface GreetReminderDeps {
  readonly ids: Pick<IdSource, 'uuid'>;
  readonly presence: Pick<PresenceService, 'tabs' | 'seenAccounts'>;
  readonly events: TabEventSink;
  /** The page may remind (its «Новые» switch); the poll asks again while it does. */
  readonly enabled: () => boolean;
  readonly session?: KeyValueStore;
  readonly log?: LogSink;
}

export interface GreetReminder {
  /** Readiness step: the events an earlier event page already reminded of. */
  restore(): Promise<void>;
  readonly enabled: () => boolean;
  /** One answer of a page's «Новые», newest rows first. */
  handle(page: Pick<SubscriberPage, 'pageId' | 'platform' | 'platformAccountId'>, answer: AudienceNewPage): void;
  /** Sign-out, another person. */
  forget(): void;
}

export function createGreetReminder(deps: GreetReminderDeps): GreetReminder {
  const log = deps.log ?? NO_LOG;
  /** Event ids already reminded of, oldest first. */
  let reminded: string[] = [];

  const persist = (): void => {
    void deps.session?.set(GREET_SESSION_KEY, reminded).catch(() => log.write({ level: 'warn', scope: 'bg.newcomers', msg: 'greeting reminders unsaved', code: 'CG-STORAGE-WRITE' }));
  };

  /** The tab of the person working under the page's creator: the one in front, else the last that reported. */
  function tabOf(page: Pick<SubscriberPage, 'platform' | 'platformAccountId'>): string | null {
    if (page.platformAccountId === null) return null;
    const keys = new Set(
      deps.presence
        .seenAccounts()
        .filter((seen) => seen.account.platform === page.platform && seen.account.platformAccountId === page.platformAccountId)
        .map((seen) => hostAccountKeyOf(seen.account.host, seen.account.hostAccountId)),
    );
    const tabs = deps.presence.tabs().filter((tab) => tab.routeAccount !== null && keys.has(tab.routeAccount));
    const rank = (tab: (typeof tabs)[number]): number => (tab.visible ? 2 : 0) + (tab.focused ? 1 : 0);
    const best = [...tabs].sort((a, b) => rank(b) - rank(a) || b.updatedAt - a.updatedAt)[0];
    return best?.tabSessionId ?? null;
  }

  return {
    async restore() {
      try {
        const raw = await deps.session?.get(GREET_SESSION_KEY);
        if (Array.isArray(raw)) reminded = raw.filter((id): id is string => typeof id === 'string').slice(-GREET_REMINDED_MAX);
      } catch {
        log.write({ level: 'warn', scope: 'bg.newcomers', msg: 'greeting reminders unreadable, starting empty', code: 'CG-STORAGE-READ' });
      }
    },
    enabled: deps.enabled,
    handle(page, answer) {
      if (!deps.enabled()) return;
      const known = new Set(reminded);
      const due = dueGreetings(answer.items, answer.serverNow).filter((item) => !known.has(item.eventRef));
      if (due.length === 0) return;
      const tab = tabOf(page);
      if (tab === null) return;
      for (const item of due) {
        const handle = item.username?.trim().replace(/^@/, '') || null;
        const name = item.displayName?.trim() || handle;
        deps.events.emit(tab, 'toast', {
          toast: {
            toastId: deps.ids.uuid(),
            kind: 'info',
            scope: `greet.${item.fanRef}`,
            fanLabel: name === null ? null : name.slice(0, 256),
            greet: { pageId: page.pageId, fanRef: item.fanRef, username: handle === null ? null : handle.slice(0, 64), since: item.subscribedAt },
          },
        });
      }
      reminded = [...reminded, ...due.map((item) => item.eventRef)].slice(-GREET_REMINDED_MAX);
      persist();
      log.write({ level: 'debug', scope: 'bg.newcomers', msg: 'greeting reminded', fields: { pageId: page.pageId, fans: due.length } });
    },
    forget() {
      reminded = [];
      persist();
    },
  };
}
