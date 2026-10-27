// The open fan's warning marks in Fansly's chat header (hub `clientFanMarks`), wired: after «Регистрация» (order 30),
// in the chunk of «Регистрация» (`lazy/fansly/registration.js`, loaded the first time the tab is on /messages).
//
// - Only where the manifest admits `fan-marks`: the header has its slot and the hub serves `fan-marks-v1` (no owner
//   switch; an older hub shows nothing), in an open one-to-one chat whose fan the page has named.
// - One read per opened chat (core application/hosts/fansly/fan-marks.ts): `fansly.marks.read` of the background, which
//   keeps each page's and fan's answer for ten minutes; never a read per row of a list.
// - The slot is in the header only while a mark applies: no node of ours there otherwise, nothing while the read runs
//   or after it failed.
import type { MountSurfaceKind } from '@cg/contracts/vm';
import { createPageContext } from '@cg/core/application/boards';
import { createFanMarks } from '@cg/core/application/hosts/fansly/fan-marks';
import { admittedOn } from '@cg/core/domain/features';
import { FAN_MARKS_TEXTS } from '@cg/core/domain/hosts/fansly/i18n';
import type { FanslyPort } from '@cg/host-fansly/isolated';
import { fanMarksSurface } from '@cg/ui/hosts/fansly/fan-marks';
import { mountKitSurface, type KitMount } from '@cg/ui/kit';

import type { SiteAppEnv } from '../../adapter';
import { fanslyRequest } from './requests';

/** The header's order of the marks: after «Заметки» (10) and «Регистрация» (20). */
const FAN_MARKS_ORDER = 30;
/** Above the background's own wait for the hub. */
const FAN_MARKS_TIMEOUT_MS = 30_000;

export function startFanslyFanMarks(env: SiteAppEnv<FanslyPort>): () => void {
  const { host, rpc, win } = env;
  const context = createPageContext({ rpc, host });
  const allowed = (): boolean => {
    const ctx = context.current();
    const report = host.probe();
    return ctx.phase === 'ready' && admittedOn(env.features, 'fan-marks', null, ctx.bootstrap, ctx.page, { ...report.capabilities, ...report.extensions['fansly-web'].capabilities }).usable;
  };
  const client = createFanMarks({
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
      const fan = route.chat === null ? null : host.fan(route.chat);
      const username = fan?.username?.trim() ?? '';
      return { pageId, accountId: identity.hostAccountId, fanId, username: username === '' ? null : username };
    },
    async read(target) {
      const answer = await fanslyRequest(rpc, 'fansly.marks.read', { pageId: target.pageId, hostAccountId: target.accountId, fanRef: target.fanId, ...(target.username === null ? {} : { username: target.username }) }, FAN_MARKS_TIMEOUT_MS);
      return answer.ok && answer.payload.ok ? { ok: true, marks: answer.payload.marks } : { ok: false };
    },
  });
  let slot: ReturnType<FanslyPort['header']['mount']> | null = null;
  let mount: KitMount | null = null;
  const place = (): void => {
    if (env.life.aborted) return;
    const view = client.view();
    const on = allowed() && (view.lists !== null || view.posts.length > 0);
    if (on && slot === null) {
      slot = host.header.mount(FAN_MARKS_ORDER);
      mount = mountKitSurface('header-slot' as MountSurfaceKind, slot.root, env.deps, fanMarksSurface(client, FAN_MARKS_TEXTS), { report: env.report });
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
