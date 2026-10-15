import type { MountSurfaceKind } from '@cg/contracts/vm';
import { createPageContext } from '@cg/core/application/boards';
import { createRegistration } from '@cg/core/application/hosts/fansly/registration';
import { admittedOn } from '@cg/core/domain/features';
import { REGISTRATION_TEXTS, REGISTRATION_I18N } from '@cg/core/domain/hosts/fansly/i18n';
import type { FanslyPort } from '@cg/host-fansly/isolated';
import { mountKitSurface, type KitMount } from '@cg/ui/kit';
import { registrationSurface } from '@cg/ui/hosts/fansly/registration';
import type { SiteAppEnv } from '../../adapter';
import { fanslyRequest } from './requests';

export function startFanslyRegistration(env: SiteAppEnv<FanslyPort>): () => void {
  const { host, rpc } = env;
  const context = createPageContext({ rpc, host });
  const allowed = (): boolean => {
    const ctx = context.current();
    const report = host.probe();
    return ctx.phase === 'ready' && admittedOn(env.features, 'registration', null, ctx.bootstrap, ctx.page, { ...report.capabilities, ...report.extensions['fansly-web'].capabilities }).usable;
  };
  const client = createRegistration({
    session() { const id = host.identity(); return id === null ? null : `${id.hostAccountId}|${id.hostLoginEpoch}`; },
    target() {
      const state = host.current();
      const { route, identity } = state;
      // Recheck the actual address at the click, before any port response can catch up.
      if (!allowed() || !host.header.available() || identity === null || route.name !== 'chat' || route.conversationRef === undefined || env.win.location.pathname !== `/messages/${route.conversationRef}` || route.conversationKind === 'group') return null;
      return { accountId: identity.hostAccountId, loginEpoch: identity.hostLoginEpoch, groupId: route.conversationRef, fanId: route.chat?.platformFanId ?? null };
    },
    async read(target) {
      const pageId = context.current().page?.pageId;
      if (pageId === undefined) return { ok: false, error: { code: 'CG-BINDING-NOT-GRANTED' } };
      const answer = await fanslyRequest(rpc, 'fansly.registration.read', { pageId, hostAccountId: target.accountId, groupId: target.groupId }, 45_000);
      return answer.ok ? answer.payload : { ok: false, error: answer.error };
    },
  });
  let slot: ReturnType<FanslyPort['header']['mount']> | null = null;
  let mount: KitMount | null = null;
  const sync = (): void => {
    if (env.life.aborted) return;
    if (allowed() && slot === null) {
      slot = host.header.mount(10);
      mount = mountKitSurface('header-slot' as MountSurfaceKind, slot.root, env.deps, registrationSurface(client, REGISTRATION_TEXTS, REGISTRATION_I18N), { report: env.report });
    } else if (!allowed() && slot !== null) {
      mount?.unmount(); mount = null; slot.remove(); slot = null;
    }
    client.sync();
  };
  const offs = [host.subscribe((e) => { if (e.type === 'route' || e.type === 'accounts') sync(); }), host.onContract(sync), host.header.onChange(sync), context.subscribe(sync)];
  sync();
  return () => { for (const off of offs) off(); client.dispose(); context.dispose(); mount?.unmount(); slot?.remove(); };
}
