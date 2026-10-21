import type { HostKind } from '@cg/contracts/hosts';
import type { SiteAccessControl, SiteAccessState, SiteAccessView } from '@cg/contracts/site-access';
import type { PageRpc } from './ports';

export function createSiteAccessControl(host: HostKind, rpc: PageRpc, permissions: { request(): Promise<boolean> }): SiteAccessControl {
  let value: SiteAccessView = { state: null, busy: false, error: null };
  let tail: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  const update = (next: SiteAccessView): void => { value = next; for (const listener of listeners) listener(); };
  const request = async (action: { enabled?: boolean; reload?: boolean }): Promise<SiteAccessState> => {
    const answer = await rpc.request('site.access', { host, ...action });
    if (!answer.ok) throw new Error(answer.error.code);
    return answer.payload;
  };
  const run = (task: () => Promise<SiteAccessState>): Promise<void> => {
    // Permission/storage events may arrive during a click. Read their final
    // state after that action, without replacing its busy state mid-flight.
    tail = tail.then(async () => {
      update({ ...value, busy: true, error: null });
      try { update({ state: await task(), busy: false, error: null }); }
      catch { update({ ...value, busy: false, error: 'CG-RUNTIME-UNREACHABLE' }); }
    });
    return tail;
  };
  return {
    get value() { return value; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    refresh: () => run(() => request({})),
    enable() {
      // MUST happen in the original click stack, before any await or RPC.
      const granted = permissions.request();
      // One step, as the old extension's install was (2026-10-21 audit, №9): switched on, the site's tabs that were
      // open reload at once — our page scripts start only with a document — instead of a second step «Перезагрузить
      // вкладки». The person is on this page, not typing in those tabs; one that failed to reload still waits with its notice.
      return run(async () => { if (!(await granted)) return request({}); return request({ enabled: true, reload: true }); });
    },
    disable: () => run(() => request({ enabled: false })),
    reload: () => run(() => request({ reload: true })),
  };
}
