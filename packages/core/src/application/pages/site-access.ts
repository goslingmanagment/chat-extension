import type { HostKind } from '@cg/contracts/hosts';
import type { SiteAccessControl, SiteAccessState, SiteAccessView } from '@cg/contracts/site-access';
import type { PageRpc } from './ports';

export function createSiteAccessControl(host: HostKind, rpc: PageRpc, permissions: { request(): Promise<boolean> }): SiteAccessControl {
  let value: SiteAccessView = { state: null, busy: false, error: null };
  const listeners = new Set<() => void>();
  const update = (next: SiteAccessView): void => { value = next; for (const listener of listeners) listener(); };
  const request = async (action: { enabled?: boolean; reload?: boolean }): Promise<SiteAccessState> => {
    const answer = await rpc.request('site.access', { host, ...action });
    if (!answer.ok) throw new Error(answer.error.code);
    return answer.payload;
  };
  const run = async (task: () => Promise<SiteAccessState>): Promise<void> => {
    update({ ...value, busy: true, error: null });
    try { update({ state: await task(), busy: false, error: null }); }
    catch { update({ ...value, busy: false, error: 'CG-RUNTIME-UNREACHABLE' }); }
  };
  return {
    get value() { return value; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    refresh: () => run(() => request({})),
    enable() {
      // MUST happen in the original click stack, before any await or RPC.
      const granted = permissions.request();
      return run(async () => { if (!(await granted)) return request({}); return request({ enabled: true }); });
    },
    disable: () => run(() => request({ enabled: false })),
    reload: () => run(() => request({ reload: true })),
  };
}
