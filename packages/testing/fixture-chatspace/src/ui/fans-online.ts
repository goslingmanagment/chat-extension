// The chat list's presence poll (metadata.ts «fans-online»), timed as
// ChatSpace's: who of the fans on screen is online is asked of the API and
// kept in the chats store (`updateOnlineStatuses`), which `isFanOnline` and
// the green dots read. A presence answer moves no cache entry — whoever
// watches only the query cache never hears of it.
// - On screen: an IntersectionObserver over the list's `[data-chat-id]` rows,
//   a MutationObserver for the rows that come and go.
// - A look asks, in one request, for the fans on screen not asked for the
//   last minute (`freshMs`); nobody to ask — the next look in 5 minutes
//   (`everyMs`). Every answer is followed by a look in 5 minutes.
// - Looks: at once when polling becomes possible, and 2 s (`settleMs`) after
//   the rows on screen changed; a look while a request is out waits 2 s.
// - Only while the page is visible, an account is open and a row is on
//   screen; another account aborts the request out; an answer that timed out
//   changes nothing, a failed one is dropped.

import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue';

import { env } from '../env';
import { record } from '../journal';
import { api } from '../net/http';
import { useChatsStore } from '../stores/chats';

const ROW = '[data-chat-id]';
/** Dispatched on `window` by `__stand.setFansOnlineTimings`: a look already waiting is put at the new distance. */
export const FANS_ONLINE_TIMINGS_EVENT = 'stand-fans-online-timings';

interface PresenceAnswer {
  readonly online?: unknown;
  readonly timed_out?: unknown;
}

const chatIdOf = (element: Element): string | undefined => (element as HTMLElement).dataset['chatId'];

export function useFansOnline(accountId: () => string, root: Ref<HTMLElement | null>): void {
  const chats = useChatsStore();
  const onScreen = ref<ReadonlySet<string>>(new Set());
  const pageVisible = ref(document.visibilityState === 'visible');

  // ── the rows on screen ──
  let intersections: IntersectionObserver | null = null;
  let mutations: MutationObserver | null = null;
  let rows = new Set<Element>();
  const onIntersect = (entries: readonly IntersectionObserverEntry[]): void => {
    const next = new Set(onScreen.value);
    let changed = false;
    for (const entry of entries) {
      const id = chatIdOf(entry.target);
      if (id === undefined || id === '') continue;
      if (entry.isIntersecting && !next.has(id)) {
        next.add(id);
        changed = true;
      } else if (!entry.isIntersecting && next.delete(id)) changed = true;
    }
    if (changed) onScreen.value = next;
  };
  const syncRows = (): void => {
    const element = root.value;
    if (element === null || intersections === null) return;
    const now = new Set(element.querySelectorAll(ROW));
    for (const row of now) if (!rows.has(row)) intersections.observe(row);
    const next = new Set(onScreen.value);
    let changed = false;
    for (const row of rows) {
      if (now.has(row)) continue;
      intersections.unobserve(row);
      const id = chatIdOf(row);
      if (id !== undefined && next.delete(id)) changed = true;
    }
    rows = now;
    if (changed) onScreen.value = next;
  };
  watch(
    root,
    (element) => {
      intersections?.disconnect();
      mutations?.disconnect();
      intersections = null;
      mutations = null;
      rows = new Set();
      onScreen.value = new Set();
      if (element === null) return;
      intersections = new IntersectionObserver(onIntersect, { root: element });
      mutations = new MutationObserver(syncRows);
      mutations.observe(element, { childList: true, subtree: true });
      syncRows();
    },
    { immediate: true, flush: 'post' },
  );

  // ── the poll ──
  const polling = computed(() => pageVisible.value && accountId() !== '' && onScreen.value.size > 0);
  let lookTimer: ReturnType<typeof setTimeout> | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let asking: AbortController | null = null;
  const stopLook = (): void => {
    if (lookTimer !== null) clearTimeout(lookTimer);
    lookTimer = null;
  };
  const stopSettle = (): void => {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = null;
  };
  const lookIn = (ms: number): void => {
    stopLook();
    lookTimer = setTimeout(() => {
      lookTimer = null;
      void look();
    }, ms);
  };

  async function look(): Promise<void> {
    stopLook();
    stopSettle();
    if (!polling.value) return;
    if (asking !== null) return lookIn(env.fansOnline.settleMs);
    const account = accountId();
    const now = Date.now();
    const due = [...onScreen.value].filter((id) => {
      if (!/^\d+$/.test(id)) return false;
      const askedAt = chats.getFanOnlineFetchedAt(account, id);
      return askedAt === null || now - askedAt >= env.fansOnline.freshMs;
    });
    if (due.length === 0) return lookIn(env.fansOnline.everyMs);
    const controller = new AbortController();
    asking = controller;
    record('fans-online-asked', { accountId: account, fanIds: due });
    try {
      const answer = await api.post(`api/v0/accounts/${account}/platforms/onlyfans/fans-online`, { json: { fan_ids: due.map(Number) }, signal: controller.signal }).json<PresenceAnswer>();
      if (answer.timed_out === true) return lookIn(env.fansOnline.everyMs);
      const online = new Set((Array.isArray(answer.online) ? answer.online : []).map(String));
      chats.updateOnlineStatuses(account, Object.fromEntries(due.map((id) => [id, online.has(id)])));
    } catch {
      // A failed or aborted round is dropped; the next look asks again.
    } finally {
      if (asking === controller) asking = null;
    }
    if (polling.value && lookTimer === null) lookIn(env.fansOnline.everyMs);
  }

  watch(onScreen, () => {
    stopSettle();
    settleTimer = setTimeout(() => {
      settleTimer = null;
      void look();
    }, env.fansOnline.settleMs);
  });
  watch(accountId, () => {
    asking?.abort();
    asking = null;
    stopLook();
    stopSettle();
  });
  watch(polling, (on) => (on ? void look() : stopLook()), { immediate: true });

  const onVisibility = (): void => {
    pageVisible.value = document.visibilityState === 'visible';
  };
  document.addEventListener('visibilitychange', onVisibility);
  const onTimings = (): void => {
    if (lookTimer !== null) lookIn(env.fansOnline.everyMs);
  };
  window.addEventListener(FANS_ONLINE_TIMINGS_EVENT, onTimings);

  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener(FANS_ONLINE_TIMINGS_EVENT, onTimings);
    intersections?.disconnect();
    mutations?.disconnect();
    asking?.abort();
    asking = null;
    stopLook();
    stopSettle();
  });
}
