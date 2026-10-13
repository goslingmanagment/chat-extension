// The background module of ChatSpace — the chunk `bg/chatspace.js`
// (docs/project-unite/architecture.md §3.3): the services only ChatSpace
// needs, out of the background core. Its own Vite build (./vite.config.ts)
// makes it one ES module; the core loads it with `import(runtime.getURL(…))`
// when a ChatSpace tab registers, when one of its requests comes, or at the
// background's start while it has unfinished work stored
// (composition/background/host-modules.ts).
//
// What it owns:
// - the X8 custody (architecture.md §6.7): the send coordinator, its attempt
//   journal `send.journal` and the browser's fuse (decision X25) — the
//   requests `send.*`;
// - the greeting leases of «Новые» (H-7) — `newcomers.claim`.
// What it does not own: the hub layer, the settings, telemetry, the logs, the
// operations, the action tokens, and the registration of a human send with
// its journal of debts (`registerNativeSend`, both sites need it) — those are
// the core's, reached through the kit. The core tells it what it must know
// (a new bootstrap, a change of the person, «Очистить локальные данные», a
// human send of a part) as events.
//
// The start replays the steps the readiness barrier ran for these services
// before F1 — the journal, the fuse, the restore of the attempts, the leases —
// each waited for at most READINESS_STEP_TIMEOUT_MS, a failed one logged and
// passed: an attempt restored half-way still holds its fan, and a journal
// that cannot be read refuses every send by itself.

import type { CgCode, CgErrorWire } from '@cg/contracts/errors';
import { narrowPlatform } from '@cg/contracts/ids';
import { sendLockKey } from '@cg/contracts/send';
import { READINESS_STEP_TIMEOUT_MS } from '@cg/core/services';
import { GreetingLeases, SendCoordinator, SendFuseKeeper, createSendJournal } from '@cg/core/services/custody';

import type { BackgroundHostHandle, BackgroundHostModule, BackgroundKit, HostAnswer, HostModuleEvent, VerifiedTabMessage } from '../src/composition/background/host-module';
import { sendJournalStoreOver } from './chatspace/send-journal-store';

/** The requests of the tab protocol this module answers (the core routes them here: composition/background.ts HOST_REQUESTS). */
const OWN_REQUESTS = ['send.begin', 'send.status', 'send.list', 'send.report', 'send.fuse', 'send.fuseState', 'send.fuseReset', 'newcomers.claim'] as const;
type OwnRequest = (typeof OWN_REQUESTS)[number];
const isOwn = (message: VerifiedTabMessage): message is VerifiedTabMessage<OwnRequest> => (OWN_REQUESTS as readonly string[]).includes(message.type);

const ok = (payload: unknown): HostAnswer => ({ ok: true, payload });
const fail = (code: CgCode, detail?: string): HostAnswer => ({ ok: false, error: (detail === undefined ? { code } : { code, detail }) satisfies CgErrorWire });

async function startChatSpace(kit: BackgroundKit): Promise<BackgroundHostHandle> {
  const { hub, storage, clock, ids, log, telemetry, router, ops, tokens, install } = kit;

  // ── the X8 custody ─────────────────────────────────────────────────────────
  const sendJournal = createSendJournal({ local: storage.local, log: log.service });
  // The X8 fuse of this browser (decision X25): kept in storage.local, it holds the preview send off on the
  // ChatSpace build it tripped on until another build or the person's reset; every tab hears of it (`send.fuse`).
  const sendFuse = new SendFuseKeeper({ clock, store: storage.localKeys, events: router.events, log: log.sink, onTrip: () => telemetry.countCode('CG-SEND-FUSE') });
  const sends = new SendCoordinator({
    clock,
    hub: {
      claim: (op) => hub.call('clientFanClaim', () => hub.facade.claim(op)),
      claimStatus: (pageLabel, fanRef) => hub.call('clientFanClaimStatus', () => hub.facade.claimStatus(pageLabel, fanRef)),
    },
    resolve: hub.resolve,
    tokens,
    events: router.events,
    store: sendJournalStoreOver(sendJournal),
    ops,
    environment: () => ops.environment(),
    get instanceId() {
      return install.instanceId();
    },
    log: log.sink,
    onSent: (fact) =>
      void telemetry.report('sent', ops.view(fact.opId), fact.opId, { part: fact.part, variant: fact.variant }, { via: 'preview', platformMessageId: fact.platformMessageId, attemptId: fact.attemptId }),
    fuse: sendFuse,
  });

  // ── «Новые»: the greeting leases of this install (H-7) ─────────────────────
  const leases = new GreetingLeases({
    clock,
    ids,
    // The facade's own errors as they are: the handler reads their wire form (the claim action is among its facts).
    hub: hub.facade,
    instanceId: () => install.instanceId(),
    owner: () => install.owner(),
    limits: () => hub.bootstrap()?.limits ?? null,
    events: router.events,
    tabs: () => router.tabs(),
    store: storage.sessionKeys,
    log: log.sink,
  });

  // ── start ──────────────────────────────────────────────────────────────────
  async function step(name: string, run: () => Promise<unknown>): Promise<void> {
    const began = clock.now();
    let timer: number | null = null;
    try {
      const outcome = await Promise.race([run().then(() => 'ok' as const), new Promise<'late'>((done) => (timer = clock.setTimer(READINESS_STEP_TIMEOUT_MS, () => done('late'))))]);
      if (outcome === 'late') log.sink.write({ level: 'warn', scope: 'bg.hosts', msg: 'chatspace start step late', fields: { step: name, ms: clock.now() - began } });
    } catch (error) {
      log.sink.write({ level: 'error', scope: 'bg.hosts', msg: 'chatspace start step failed', fields: { step: name, error: error instanceof Error ? error.name : typeof error } });
    } finally {
      if (timer !== null) clock.clearTimer(timer);
    }
  }
  await step('send-journal', () => sendJournal.start());
  // The fuse first: the coordinator's conditions read it from the first click on.
  await step('sends', async () => {
    await sendFuse.load();
    await sends.restore();
  });
  await step('leases', () => leases.restore());

  async function onTabMessage(message: VerifiedTabMessage): Promise<HostAnswer> {
    return isOwn(message) ? answer(message) : fail('CG-UNKNOWN', `${message.type} is not ChatSpace's`);
  }

  async function answer(message: VerifiedTabMessage<OwnRequest>): Promise<HostAnswer> {
    const { sender } = message;
    switch (message.type) {
      case 'send.begin':
        if (sender.kind !== 'tab') return fail('CG-UI-FAILED', 'tab only');
        return ok(await sends.begin(sender.tabSessionId, message.payload));
      case 'send.status':
        return ok({ view: sends.status(message.payload.attemptId) });
      case 'send.list': {
        // What a tab that lost its own tracking (a reload) holds the fan by (§6.7.8): the journal of this install.
        const { pageId, fanRef } = message.payload;
        const page = await hub.page(pageId, sender);
        if (!page.ok) return fail(page.code);
        const platform = narrowPlatform(page.page.platform);
        const signedIn = hub.session();
        if (platform === null || signedIn === null) return fail('CG-BINDING-NOT-GRANTED');
        const known = sends.attemptsOf(sendLockKey({ hubOrigin: signedIn.hubOrigin, pageId, platform, fanRef }));
        return ok({ attempts: [...known.attempts], truncated: known.truncated });
      }
      case 'send.report':
        if (sender.kind !== 'tab') return fail('CG-UI-FAILED', 'tab only');
        return ok({ recorded: await sends.report(sender.tabSessionId, message.payload.view, message.payload.pendingId) });
      // The fuse (decision X25): a tab's MAIN saw, after a send, what trips it; «Статус» reads and resets it.
      case 'send.fuse': {
        if (sender.kind !== 'tab') return fail('CG-UI-FAILED', 'tab only');
        const { fact, build } = message.payload;
        return ok(await sendFuse.trip({ reason: fact.reason, where: fact.where, attemptId: fact.attemptId, build }));
      }
      case 'send.fuseState':
        await sendFuse.load();
        return ok(sendFuse.current());
      case 'send.fuseReset':
        return ok(await sendFuse.reset());
      case 'newcomers.claim': {
        if (sender.kind !== 'tab') return fail('CG-UI-FAILED', 'tab only');
        const { pageId, fanRef, action } = message.payload;
        const page = await hub.page(pageId, sender);
        if (!page.ok) return fail(page.code);
        try {
          const answer = await leases.act(sender.tabSessionId, page.page, fanRef, action);
          return answer.ok ? ok(answer.state) : fail(answer.code);
        } catch (error) {
          return { ok: false, error: hub.errorWire(error) };
        }
      }
    }
  }

  async function onEvent(event: HostModuleEvent): Promise<void> {
    switch (event.kind) {
      case 'bootstrap':
        // Fans that waited for a page label are read again, and their owed reports go out.
        await sends.bootstrapChanged();
        return;
      case 'session':
        // §9.4: the lease tokens were the previous person's; at sign-out what is finished goes, open X8 records stay.
        if (event.ownerChanged) leases.forgetAll();
        if (event.signedOut) await sendJournal.removeFinished();
        return;
      case 'clear-finished':
        await sendJournal.removeFinished();
        return;
      case 'native-sent':
        // The part is journaled as delivered, so the preview that made it shows it «Отправлено» and offers the
        // group's next part (`send.list`, `send.state`). Never a send of ours.
        sends.nativeSent({ attemptId: event.attemptId, view: event.view, part: event.part, platformMessageId: event.platformMessageId });
        return;
    }
  }

  return {
    onTabMessage,
    onEvent,
    facts: () => ({ sends: { ...sends.counts(), journal: sendJournal.list() }, sendFuse: sendFuse.current() }),
    async dispose() {
      await Promise.all([sends.idle(), leases.idle(), sendFuse.idle()]);
      sendJournal.dispose();
    },
  };
}

/** A module of its own: `start` answers one handle however often it is called. */
export function chatSpaceModule(): BackgroundHostModule {
  let started: Promise<BackgroundHostHandle> | null = null;
  return { host: 'chatspace', start: (kit) => (started ??= startChatSpace(kit)) };
}

/** One per realm of the event page: what the core reads from `bg/chatspace.js`. */
export default chatSpaceModule();
