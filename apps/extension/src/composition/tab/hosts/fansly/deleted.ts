// «Фан удалил» in Fansly's chat header (hub `clientDeletedMessages`), wired: after the fan's marks (order 40), in the chunk
// of «Регистрация» (`lazy/fansly/registration.js`, loaded the first time the tab is on /messages).
//
// - Only where the manifest admits `deleted-messages`: the header has its slot and the hub serves `deleted-messages-v1`
//   (no owner switch; an older hub shows nothing), in an open one-to-one chat whose fan the page has named.
// - One read when a chat opens (core application/hosts/fansly/deleted.ts), and again after MAIN heard a message of that
//   chat deleted: the hub stores the deletion from its own socket a moment later. Never a read per row of a list.
// - The slot is in the header only while the fan has a deleted message: no node of ours there otherwise, nothing while
//   the read runs or after it failed.
import type { MountSurfaceKind } from '@cg/contracts/vm';
import { createPageContext } from '@cg/core/application/boards';
import { createDeletedMessages } from '@cg/core/application/hosts/fansly/deleted';
import { admittedOn } from '@cg/core/domain/features';
import { DELETED_TEXTS } from '@cg/core/domain/hosts/fansly/i18n';
import type { FanslyPort } from '@cg/host-fansly/isolated';
import { deletedMessagesSurface } from '@cg/ui/hosts/fansly/deleted';
import { mountKitSurface, type KitMount } from '@cg/ui/kit';

import type { SiteAppEnv } from '../../adapter';
import { fanslyRequest } from './requests';

/** The header's order of the mark: after «Заметки» (10), «Регистрация» (20) and the fan's marks (30). */
const DELETED_ORDER = 40;
/** Above the background's own wait for the hub. */
const DELETED_TIMEOUT_MS = 30_000;

export function startFanslyDeleted(env: SiteAppEnv<FanslyPort>): () => void {
  const { host, rpc, win } = env;
  const context = createPageContext({ rpc, host });
  const allowed = (): boolean => {
    const ctx = context.current();
    const report = host.probe();
    return ctx.phase === 'ready' && admittedOn(env.features, 'deleted-messages', null, ctx.bootstrap, ctx.page, { ...report.capabilities, ...report.extensions['fansly-web'].capabilities }).usable;
  };
  const client = createDeletedMessages({
    session() {
      const id = host.identity();
      return id === null ? null : `${id.hostAccountId}|${id.hostLoginEpoch}|${String(context.current().epoch)}`;
    },
    target() {
      const { route, identity } = host.current();
      const pageId = context.current().page?.pageId;
      const fanId = route.chat?.platformFanId ?? null;
      // The address is read again: the port's route may lag a switch the person just made.
      if (!allowed() || pageId === undefined || !host.header.available() || identity === null || route.name !== 'chat' || route.conversationRef === undefined || route.conversationKind === 'group' || win.location.pathname !== `/messages/${route.conversationRef}` || fanId === null) return null;
      return { pageId, accountId: identity.hostAccountId, fanId };
    },
    async read(target) {
      const answer = await fanslyRequest(rpc, 'fansly.deleted.read', { pageId: target.pageId, hostAccountId: target.accountId, fanRef: target.fanId }, DELETED_TIMEOUT_MS);
      return answer.ok && answer.payload.ok ? { ok: true, deleted: answer.payload.deleted } : { ok: false };
    },
    now: () => Date.now(),
    setTimer: (ms, run) => win.setTimeout(run, ms),
    clearTimer: (handle) => win.clearTimeout(handle as number),
  });
  let slot: ReturnType<FanslyPort['header']['mount']> | null = null;
  let mount: KitMount | null = null;
  const report = (): void => {
    // Test builds: what the e2e and `pnpm see` read — counts only, never a text.
    if (env.probe === null) return;
    const view = client.view();
    env.probe.set('deleted', { total: view.total, shown: view.messages.length, fresh: view.fresh });
  };
  const place = (): void => {
    if (env.life.aborted) return;
    report();
    const on = allowed() && client.view().total > 0;
    if (on && slot === null) {
      slot = host.header.mount(DELETED_ORDER);
      mount = mountKitSurface('header-slot' as MountSurfaceKind, slot.root, env.deps, deletedMessagesSurface(client, DELETED_TEXTS), { report: env.report });
    } else if (!on && slot !== null) {
      mount?.unmount();
      mount = null;
      slot.remove();
      slot = null;
    }
  };
  const sync = (): void => {
    if (env.life.aborted) return;
    client.sync();
    place();
  };
  const offs = [
    host.subscribe((event) => {
      if (event.type === 'route' || event.type === 'accounts') sync();
    }),
    host.onContract(sync),
    host.header.onChange(sync),
    context.subscribe(sync),
    client.subscribe(place),
    // A message of the open chat went: the fan's, maybe. The hub's answer says.
    host.fansly.onDeleted((groupId) => {
      if (host.current().route.conversationRef === groupId) client.heard();
    }),
  ];
  sync();
  return () => {
    for (const off of offs.splice(0)) off();
    client.dispose();
    context.dispose();
    mount?.unmount();
    slot?.remove();
    mount = null;
    slot = null;
  };
}
