// Voice notes in the background (1.47.0): the core's voice service over the
// hub facade, storage.local, the scheduler and the tabs — and the voice
// script as an operation of EVERY site's slice: the scheduler takes a site's
// own drivers from its running module (Fansly's «Заполнить из чата») and the
// voice script's from here, so ChatSpace has it without a module of its own.
//
// What a failed hub call reads as is decided here, where the facade's error
// objects are known: the hub's voice codes first (HUB_VOICE_ERROR_CODES),
// then the shared reading; and whether the request reached the hub — a
// refusal said by the hub or by our hub layer spent nothing, anything else
// may have (the take is then uncertain and only the person asks again).

import { type CgErrorWire } from '@cg/contracts/errors';
import { isHubCallError, isHubCheckError, type HubFacade } from '@cg/contracts/hub';
import { type HostKind } from '@cg/contracts/hosts';
import type { HumanCause } from '@cg/contracts/ids';
import type { SiteOpView } from '@cg/contracts/ops';
import { HUB_VOICE_ERROR_CODES, VOICE_LIMITS, type HubVoiceErrorCode, type VoiceSession } from '@cg/contracts/voice';
import { type ActionTokens, type SiteOperations, type StartOutcome } from '@cg/core/services';
import { VOICE_SCRIPT_DRIVER, VoiceService, readVoiceOpView, type VoiceFailure, type VoicePageLookup } from '@cg/core/services/voice';
import type { KeyValueStore, RpcResult, TabRequestHandler } from '@cg/platform';

import { type KitSender } from './host-module';

export interface BackgroundVoiceDeps {
  readonly hub: () => HubFacade;
  readonly store: KeyValueStore;
  readonly page: (pageId: number, sender: KitSender) => Promise<VoicePageLookup>;
  /** The label of a page the current bootstrap grants; null — none. */
  readonly pageLabel: (pageId: number) => string | null;
  readonly tokens: ActionTokens;
  readonly scheduler: {
    start(tabSessionId: string, start: Parameters<VoiceService<KitSender>['script']>[1]): Promise<StartOutcome>;
    siteView(opId: string, host: HostKind): SiteOpView | null;
  };
  /** Whether the tab's site may act now (its switch in the popup, R20 P9a): a voice request of a switched-off site is refused. */
  readonly siteActive: (tabSessionId: string) => boolean;
  readonly owner: () => { readonly hubOrigin: string; readonly userId: number } | null;
  readonly emit: (change: { readonly chat: VoiceSession['chat']; readonly conversationRef: string; readonly session: VoiceSession | null }) => void;
  readonly errorOf: (error: unknown) => CgErrorWire;
  readonly ids: { uuid(): string };
  readonly log: ConstructorParameters<typeof VoiceService<KitSender>>[0]['log'];
}

const HOSTS: readonly HostKind[] = ['chatspace', 'fansly-web'];

/** A failed voice call: its error, and whether it reached the hub (see the header). */
export function voiceFailureOf(error: unknown, errorOf: (error: unknown) => CgErrorWire): VoiceFailure {
  if (isHubCheckError(error)) return { error: errorOf(error), reached: 'no' };
  if (isHubCallError(error)) {
    const failure = error.failure;
    if (failure.kind !== 'http') return { error: errorOf(error), reached: 'unknown' };
    const own = failure.error !== null && Object.hasOwn(HUB_VOICE_ERROR_CODES, failure.error) ? HUB_VOICE_ERROR_CODES[failure.error as HubVoiceErrorCode].cg : null;
    const read: CgErrorWire = own === null ? errorOf(error) : { code: own, httpStatus: failure.status };
    // A 4xx is the hub's refusal; of the 5xx only «no provider» says the render was never admitted.
    const refused = failure.status < 500 || failure.error === 'voice_provider_unavailable';
    return { error: read, reached: refused ? 'refused' : 'unknown' };
  }
  return { error: { code: 'CG-UNKNOWN' }, reached: 'unknown' };
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let out = '';
  for (const byte of digest) out += byte.toString(16).padStart(2, '0');
  return out;
}

export function createBackgroundVoice(deps: BackgroundVoiceDeps) {
  const tabOf = (sender: KitSender): string | null => (sender.kind === 'tab' ? sender.tabSessionId : null);
  const service = new VoiceService<KitSender>({
    now: () => Date.now(),
    ids: deps.ids,
    timers: { set: (callback, ms) => setTimeout(callback, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    store: deps.store,
    hub: {
      create: (request) => deps.hub().voiceNoteCreate(request),
      status: (ref) => deps.hub().voiceNoteStatus(ref),
      audio: (ref) => deps.hub().voiceNoteAudio(ref),
      allowance: (query) => deps.hub().voiceNoteAllowance(query),
    },
    failure: (error) => voiceFailureOf(error, deps.errorOf),
    page: deps.page,
    pageLabel: deps.pageLabel,
    tabOf,
    redeem: (tabSessionId: string, cause: HumanCause) => deps.tokens.redeem({ tabSessionId, kind: 'generate', surface: 'dock', actionToken: cause.actionToken }),
    ops: {
      start: (tabSessionId, start) => deps.scheduler.start(tabSessionId, start),
      view(opId) {
        for (const host of HOSTS) {
          const view = readVoiceOpView(deps.scheduler.siteView(opId, host));
          if (view !== null) return view;
        }
        return null;
      },
    },
    owner: deps.owner,
    emit: deps.emit,
    sha256: sha256Hex,
    log: deps.log,
  });

  /** A site's operations with the voice script added: its own drivers (if its module runs) beside it. */
  function withVoice(host: HostKind, own: SiteOperations | null): SiteOperations {
    return {
      host,
      drivers: { ...(own?.drivers ?? {}), 'voice-script': VOICE_SCRIPT_DRIVER },
      readView: (value) => readVoiceOpView(value) ?? own?.readView(value) ?? null,
      done(view) {
        const voice = view.feature === 'voice-script' ? readVoiceOpView(view) : null;
        if (voice !== null) service.scriptDone(voice);
        else own?.done(view);
      },
    };
  }

  const refuseSwitchedOff = (sender: KitSender): RpcResult<never> | null =>
    sender.kind === 'tab' && !deps.siteActive(sender.tabSessionId) ? { ok: false, error: { code: 'CG-SITE-OFF' } } : null;
  const ok = <T>(payload: T): RpcResult<T> => ({ ok: true, payload });

  const handlers: {
    readonly 'voice.read': TabRequestHandler<'voice.read'>;
    readonly 'voice.allowance': TabRequestHandler<'voice.allowance'>;
    readonly 'voice.script': TabRequestHandler<'voice.script'>;
    readonly 'voice.edit': TabRequestHandler<'voice.edit'>;
    readonly 'voice.take': TabRequestHandler<'voice.take'>;
    readonly 'voice.check': TabRequestHandler<'voice.check'>;
    readonly 'voice.audio': TabRequestHandler<'voice.audio'>;
    readonly 'voice.attached': TabRequestHandler<'voice.attached'>;
    readonly 'voice.discard': TabRequestHandler<'voice.discard'>;
  } = {
    // Storage that did not answer is the read's failure: the studio says so and its next open reads again.
    'voice.read': async ({ pageId, conversationRef }, sender) => {
      const read = await service.read(sender, pageId, conversationRef);
      return read.ok ? ok({ session: read.session }) : read;
    },
    // 1.49.0: a free read, like `voice.read` — no token, and a site switched off still reads it.
    'voice.allowance': async ({ pageId }, sender) => ok(await service.allowance(sender, pageId)),
    'voice.script': async ({ start, sessionId }, sender) => refuseSwitchedOff(sender) ?? ok(await service.script(sender, start, sessionId)),
    'voice.edit': async ({ sessionId, text }, sender) => ok(await service.edit(sender, sessionId, text)),
    'voice.take': async ({ sessionId, takeId, script, cause }, sender) => refuseSwitchedOff(sender) ?? ok(await service.take(sender, sessionId, takeId, script, cause)),
    'voice.check': async ({ sessionId, takeId, cause }, sender) => refuseSwitchedOff(sender) ?? ok(await service.check(sender, sessionId, takeId, cause)),
    'voice.audio': async ({ sessionId, takeId }, sender) => ok(await service.audio(sender, sessionId, takeId)),
    'voice.attached': async ({ sessionId, takeId, state }, sender) => ok(await service.attached(sender, sessionId, takeId, state)),
    'voice.discard': async ({ sessionId }, sender) => ok(await service.discard(sender, sessionId)),
  };

  return { service, withVoice, handlers, audioMaxBytes: VOICE_LIMITS.audioMaxBytes };
}
