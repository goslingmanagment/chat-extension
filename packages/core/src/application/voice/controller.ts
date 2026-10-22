// The voice studio's controller (1.46.0; contracts voice.ts, vm/voice.ts):
// the open chat's voice as one view — its script, its takes, the next step —
// and the person's clicks. The same on both sites: what differs is the
// site's handover of the file (HostPort.attachFile) and the chat's ids.
//
// The flow. The Voice chip opens the studio in the dock's sheet; with a
// draft in the field and nothing written yet, the script is written at once
// (free of characters, the shared scheduler's `voice-script`). The person
// edits it, picks a preset or «Переписать» (the takes stay), and presses
// «Озвучить» — the one paid step, by that click only. A ready take plays in
// the studio and goes into the chat's field by «Прикрепить»; the person sends
// it with the site's own Send. Nothing here sends, and nothing paid or handed
// over is repeated by itself: a take whose create was not answered, or a
// handover that was not seen, waits for the person's own click.

import { type CgCode, type CgErrorWire } from '@cg/contracts/errors';
import { type AttachIntent, type AttachReceipt } from '@cg/contracts/host';
import { VOICE_LIMITS, VOICE_TONE_REPLY, VOICE_TONES, type VoiceSession, type VoiceTake, type VoiceTone } from '@cg/contracts/voice';
import { type ActionButtonVM, type ActionReceipt, type Msg, type UiActionOf, type VoiceTakeVM, type VoiceVM } from '@cg/contracts/vm';

import { windowFor } from '../../domain/features';
import { canonicalVoiceScript, currentScriptText, takeIsStale, voiceScriptIssue, voiceSeconds, type VoiceScriptIssue } from '../../domain/voice';
import { createSurface, done, refused, type ActionHandlers, type AiController, type CauseKind } from '../ai/surface';
import { button, errorVm, msg, views } from '../ai/view-models';
import { type DeskUi } from '../ai/voice-desk';
import { type AiWorkspace, type OpenChat, type ReadyTarget } from '../ai/workspace';

export type VoiceController = AiController;

/** What a refusal of a handover reads as (the studio's card). */
const ATTACH_REFUSAL_CODE: Readonly<Record<Extract<AttachReceipt, { state: 'refused' }>['reason'], CgCode>> = {
  identity: 'CG-INSERT-CHAT-CHANGED',
  cause: 'CG-UI-FAILED',
  'anchor-missing': 'CG-VOICE-ATTACH',
  busy: 'CG-VOICE-ATTACH-BUSY',
  permission: 'CG-VOICE-ATTACH-PERMISSION',
};

function issueMsg(issue: VoiceScriptIssue): Msg {
  switch (issue.kind) {
    case 'empty':
      return msg('voice.script.empty');
    case 'too-long':
      return msg('voice.script.tooLong', { max: issue.max });
    case 'markup':
      return msg('voice.script.markup');
    case 'bad-tag':
      return msg('voice.script.badTag', { tag: issue.tag });
  }
}

const TAKE_STATE: Readonly<Record<VoiceTake['state'], VoiceTakeVM['state']>> = {
  creating: 'working',
  working: 'working',
  uncertain: 'uncertain',
  ready: 'ready',
  failed: 'failed',
  refused: 'refused',
  expired: 'expired',
};

export function createVoiceController(ws: AiWorkspace): VoiceController {
  const { i18n, clock, ids } = ws.ports;
  const desk = ws.voice;

  /** The open chat with what a voice needs: its page and its target. null — nothing to act on. */
  function open(): { readonly chat: OpenChat; readonly ready: ReadyTarget } | null {
    const { chat, ready } = ws.situation();
    return chat === null || ready === null ? null : { chat, ready };
  }

  /** A working take turns «дольше обычного» (and gets «Проверить») by itself: the view is built again at that moment. */
  let slowTimer: unknown = null;
  let slowAt = Infinity;
  function wakeWhenSlow(takes: readonly VoiceTake[]): void {
    const now = clock.now();
    const next = Math.min(...takes.filter((take) => (take.state === 'creating' || take.state === 'working') && now - take.createdAt <= VOICE_LIMITS.slowMs).map((take) => take.createdAt + VOICE_LIMITS.slowMs + 1));
    if (!Number.isFinite(next) || next >= slowAt) return;
    if (slowTimer !== null) clock.clearTimer(slowTimer);
    slowAt = next;
    slowTimer = clock.setTimer(Math.max(0, next - now), () => {
      slowTimer = null;
      slowAt = Infinity;
      ws.bump();
    });
  }

  /** The text a take would voice now: the person's while they type, else the session's. */
  function textOf(session: VoiceSession, ui: DeskUi): string | null {
    return ui.text ?? currentScriptText(session);
  }

  /** The take «Прикрепить» puts into the field: the chosen one while it is ready, else the newest ready one of this text, else the newest ready one. */
  function selectedOf(session: VoiceSession, ui: DeskUi, text: string | null): VoiceTake | null {
    const ready = session.takes.filter((take) => take.state === 'ready');
    const chosen = ready.find((take) => take.takeId === ui.selected);
    if (chosen !== undefined) return chosen;
    const fresh = ready.filter((take) => !takeIsStale(take, text));
    return fresh.at(-1) ?? ready.at(-1) ?? null;
  }

  function takeVm(session: VoiceSession, take: VoiceTake, n: number, text: string | null, ui: DeskUi, studio: boolean, handle: string): VoiceTakeVM {
    const state = TAKE_STATE[take.state];
    // A ready take's MP3 is fetched once the studio shows it (never in the background of a closed studio).
    if (state === 'ready' && studio) desk.fetchAudio(session.sessionId, take.takeId);
    const audio = desk.audio(take.takeId);
    const slow = state === 'working' && clock.now() - take.createdAt > VOICE_LIMITS.slowMs;
    // The handover's own outcome in this tab is newer than the session's word of it.
    const attach = ui.attach?.takeId === take.takeId ? ui.attach : null;
    const attached = attach?.state === 'attached' ? 'attached' : attach?.state === 'unknown' ? 'unknown' : (take.attached?.state ?? null);
    const error = state === 'ready' ? (audio?.state === 'failed' ? audio.error : null) : state === 'working' ? null : take.error;
    return {
      takeId: take.takeId,
      n,
      state,
      startedAt: take.createdAt,
      slow,
      stale: takeIsStale(take, text),
      audio: audio?.state === 'ready' ? { sha256: audio.sha256, bytes: audio.bytes } : null,
      loading: state === 'ready' && (audio === null || audio.state === 'loading'),
      attached,
      error: error === null ? null : errorVm(error, i18n),
      charged: take.billed,
      // «Проверить» — free: what became of a take nobody saw the end of, or one that takes long.
      check: state === 'uncertain' || slow ? { type: 'CheckVoiceTake', targetHandle: handle, takeId: take.takeId } : null,
    };
  }

  function build(): VoiceVM {
    const now = open();
    const empty: VoiceVM = {
      view: views.empty(msg('common.empty')),
      open: false,
      targetHandle: null,
      fanName: null,
      stage: 'empty',
      source: null,
      tone: 'calm',
      tones: VOICE_TONES,
      toneReason: null,
      script: null,
      takes: [],
      selected: null,
      error: null,
      primary: null,
      secondary: null,
      restart: null,
      confirm: null,
      attach: null,
    };
    if (now === null) return empty;
    const { chat, ready } = now;
    const handle = chat.handle;
    const ui = desk.ui(chat.key);
    const studio = ws.sheet(chat.key)?.kind === 'voice';
    const situation = ws.situation();
    const state = desk.session(ready.page.pageId, chat.conversationRef);
    if (state.state === 'loading') return { ...empty, view: views.loading(), open: studio, targetHandle: handle, fanName: situation.fanName };
    // The background did not answer the read: said in the studio; the chip's next click reads again.
    if (state.state === 'failed') return { ...empty, view: views.ready(), open: studio, targetHandle: handle, fanName: situation.fanName, error: errorVm(state.error, i18n) };
    const session = state.session;
    if (session !== null) wakeWhenSlow(session.takes);
    const composer = situation.host.composer;
    const draftEmpty = composer === null || composer.draft.provenance === 'empty';
    const fanName = situation.fanName;
    const writing = session?.writing ?? null;
    const text = session === null ? null : textOf(session, ui);
    const script = session?.script ?? null;
    const stage: VoiceVM['stage'] = writing !== null ? 'writing' : script !== null ? 'ready' : session?.error !== null && session?.error !== undefined ? 'failed' : 'empty';
    const tone: VoiceTone = writing?.tone ?? script?.tone ?? ui.tone;
    const toneReason = writing !== null ? ws.ports.catalog.reason('voice-writing') : stage === 'empty' && draftEmpty ? ws.ports.catalog.reason('needs-draft') : null;

    let scriptVm: VoiceVM['script'] = null;
    let issue: VoiceScriptIssue | null = null;
    if (writing !== null) {
      const streamed = desk.streamText(writing.opId);
      scriptVm = { text: streamed, streaming: true, edited: false, chars: streamed.length, max: VOICE_LIMITS.scriptChars, seconds: voiceSeconds(streamed.length), issue: null };
    } else if (script !== null && text !== null) {
      const canonical = canonicalVoiceScript(text);
      issue = voiceScriptIssue(canonical, VOICE_LIMITS.scriptChars);
      scriptVm = {
        text,
        streaming: false,
        edited: canonical !== canonicalVoiceScript(script.original),
        chars: canonical.length,
        max: VOICE_LIMITS.scriptChars,
        seconds: voiceSeconds(canonical.length),
        issue: issue === null ? null : issueMsg(issue),
      };
    }

    const takeVms: VoiceTakeVM[] = session === null ? [] : session.takes.map((take, index) => takeVm(session, take, index + 1, text, ui, studio, handle));
    const selected = session === null ? null : selectedOf(session, ui, text);
    const chars = scriptVm?.chars ?? 0;

    // The footer: the next step first, the other one beside it.
    let primary: ActionButtonVM | null = null;
    let secondary: ActionButtonVM | null = null;
    if (stage === 'empty' || stage === 'failed') {
      // A script that failed is asked again from the draft it was asked for; a first one — from the field.
      const again = stage === 'failed' && session !== null;
      primary = button('voice.empty.write', { type: 'WriteVoiceScript', targetHandle: handle, tone: ui.tone, from: again ? 'session' : 'field' }, !again && draftEmpty ? { enabled: false, reason: ws.ports.catalog.reason('needs-draft') } : {});
    } else if (stage === 'ready' && session !== null) {
      const full = session.takes.length >= VOICE_LIMITS.takesPerSession;
      const blocked = issue !== null ? ws.ports.catalog.reason('voice-issue') : full ? ws.ports.catalog.reason('voice-takes-full', { max: VOICE_LIMITS.takesPerSession }) : null;
      const fresh = session.takes.filter((take) => !takeIsStale(take, text));
      const freshWorking = fresh.some((take) => take.state === 'creating' || take.state === 'working');
      // «Озвучить» first, «Озвучить новый текст» after an edit, «Ещё вариант» of the same text.
      const makeLabel: Msg = session.takes.length === 0 ? msg('voice.make', { chars }) : fresh.length === 0 ? msg('voice.makeNew', { chars }) : msg('voice.makeAgain', { chars });
      const make = button(makeLabel, { type: 'MakeVoiceTake', targetHandle: handle }, blocked === null ? {} : { enabled: false, reason: blocked });
      const attach = selected === null ? null : attachButton(selected, ui, fanName, handle);
      if (attach !== null && selected !== null && !takeIsStale(selected, text)) {
        // A take of this text is ready: it goes into the field; another take is the second choice.
        primary = attach;
        secondary = make;
      } else if (freshWorking) {
        // A take of this text renders: the next step is waiting for it.
        primary = button('voice.take.working', { type: 'MakeVoiceTake', targetHandle: handle }, { enabled: false, reason: ws.ports.catalog.reason('voice-working') });
        secondary = attach;
      } else {
        // No take of this text yet (or the text changed since): voicing is the next step; an older take stays attachable.
        primary = make;
        secondary = attach;
      }
    }
    const restart =
      session !== null && (session.takes.length > 0 || script !== null)
        ? button('voice.restart', { type: 'NewVoice', targetHandle: handle }, draftEmpty ? { enabled: false, reason: ws.ports.catalog.reason('needs-draft') } : {})
        : null;

    const attachVm: VoiceVM['attach'] =
      ui.attach === null
        ? null
        : {
            takeId: ui.attach.takeId,
            n: (session?.takes.findIndex((take) => take.takeId === ui.attach?.takeId) ?? -1) + 1,
            state: ui.attach.state,
            error: ui.attach.error === null ? null : errorVm(ui.attach.error, i18n),
            // The draft the script came from is still in the field: it goes with the voice unless the person removes it.
            leftover: ui.attach.state === 'attached' && !draftEmpty ? { clear: null } : null,
          };

    return {
      view: views.ready(),
      open: studio,
      targetHandle: handle,
      fanName,
      stage,
      source: session?.draft ?? null,
      tone,
      tones: VOICE_TONES,
      toneReason,
      script: scriptVm,
      takes: takeVms,
      selected: selected?.takeId ?? null,
      error: ui.error !== null ? errorVm(ui.error, i18n) : session?.error !== null && session?.error !== undefined && writing === null ? errorVm(session.error, i18n) : null,
      primary,
      secondary,
      restart,
      confirm: confirmVm(session, ui, handle),
      attach: attachVm,
    };
  }

  function attachButton(take: VoiceTake, ui: DeskUi, fanName: string | null, handle: string): ActionButtonVM {
    const label = fanName === null ? msg('voice.attachNoName') : msg('voice.attach', { name: fanName });
    const action = { type: 'AttachVoiceTake', targetHandle: handle, takeId: take.takeId } as const;
    const host = ws.ports.host;
    const capability = ws.situation().host.contract.capabilities.fileAttach;
    if (host.attachFile === undefined || capability?.state !== 'on') return button(label, action, { enabled: false, reason: ws.ports.catalog.reason('voice-attach-off') });
    if (ui.attach !== null && ui.attach.state === 'handing') return button(label, action, { enabled: false, reason: ws.ports.catalog.reason('voice-attaching') });
    return button(label, action);
  }

  function confirmVm(session: VoiceSession | null, ui: DeskUi, handle: string): VoiceVM['confirm'] {
    const ask = ui.confirm;
    if (ask === null || session === null) return null;
    const cancel = { type: 'DismissVoiceConfirm', targetHandle: handle } as const;
    switch (ask.kind) {
      case 'new': {
        const working = session.takes.some((take) => take.state === 'creating' || take.state === 'working');
        return { lead: msg(working ? 'voice.confirm.working' : 'voice.confirm.unattached'), question: msg('voice.confirm.question'), confirm: button('voice.confirm.yes', { type: 'NewVoice', targetHandle: handle, confirmed: true }), cancel };
      }
      case 'rewrite':
        return { lead: msg('voice.script.edited'), question: msg('voice.rewriteTooltip'), confirm: button('voice.rewrite', { type: 'WriteVoiceScript', targetHandle: handle, tone: ask.tone, from: 'session', confirmed: true }), cancel };
      case 'again':
        return { lead: msg('voice.attach.againLead'), question: msg('voice.attach.againQuestion'), confirm: button('voice.attach.again', { type: 'AttachVoiceTake', targetHandle: handle, takeId: ask.takeId, again: true }), cancel };
    }
  }

  // ── actions ──────────────────────────────────────────────────────────────

  /** The open chat, when the handle names it. */
  function chatOf(handle: string): { readonly chat: OpenChat; readonly ready: ReadyTarget } | null {
    const now = open();
    return now !== null && now.chat.handle === handle ? now : null;
  }

  const gone = (type: UiActionOf<'ShowVoice'>['type'] | string): ActionReceipt => refused(ws, type as never, { code: 'CG-CONTEXT-CHANGED' });

  /** A refusal said in the studio itself (and as the click's receipt). */
  function studioError(key: OpenChat['key'], type: string, error: CgErrorWire): ActionReceipt {
    desk.ui(key).error = error;
    ws.bump();
    return refused(ws, type as never, error);
  }

  /** The script from the draft: the field's now (a first script, «Новый войс») or the session's (a rewrite). */
  async function write(target: { readonly chat: OpenChat; readonly ready: ReadyTarget }, tone: VoiceTone, from: 'field' | 'session', cause: CauseKind, type: string): Promise<ActionReceipt> {
    const { chat, ready } = target;
    const ui = desk.ui(chat.key);
    ui.error = null;
    ui.confirm = null;
    ui.tone = tone;
    const admitted = ws.admitted(ws.situation().host, ready, 'voice', 'generate');
    if (!admitted.usable) return studioError(chat.key, type, { code: 'CG-FEATURE-DISABLED', ...(admitted.reason === null ? {} : { detail: admitted.reason }) });
    const state = desk.session(ready.page.pageId, chat.conversationRef);
    const session = state.state === 'ready' ? state.session : null;
    let draft: { readonly text: string; readonly revision: number; readonly digest: string };
    if (from === 'session' && session !== null) {
      await desk.save(chat.key, session.sessionId);
      draft = { text: session.draft, revision: 0, digest: digestOf(session.draft) };
    } else {
      if (chat.identity === null) return studioError(chat.key, type, { code: 'CG-GATE-CHAT-LOADING' });
      let read;
      try {
        read = await ws.ports.host.readDraft(chat.identity);
      } catch {
        return studioError(chat.key, type, { code: 'CG-HOST-NOT-READY' });
      }
      if (read.plainText.trim() === '') return studioError(chat.key, type, { code: 'CG-GATE-DRAFT' });
      draft = { text: read.plainText.slice(0, VOICE_LIMITS.draftMaxChars), revision: read.revision, digest: read.digest };
    }
    const token = await ws.token('generate', 'dock', cause);
    if (!token.ok) return studioError(chat.key, type, token.error);
    if (ws.ports.host.current().route.epoch !== chat.routeEpoch) return gone(type);
    const window = windowFor('reply', undefined, ready.settings, ready.bootstrap);
    const answer = await ws.ports.rpc.request('voice.script', {
      start: { feature: 'voice-script', target: ready.target, cause: token.payload, window, tone: VOICE_TONE_REPLY[tone], draft, ...(from === 'session' ? { force: true } : {}) },
      sessionId: from === 'session' && session !== null ? session.sessionId : null,
    });
    if (!answer.ok) return studioError(chat.key, type, answer.error);
    desk.apply(answer.payload);
    if (!answer.payload.ok) return studioError(chat.key, type, answer.payload.error);
    // A new script is the person's text again.
    ui.text = null;
    ws.bump();
    return done(type as never, 'started');
  }

  async function attach(action: UiActionOf<'AttachVoiceTake'>, cause: CauseKind): Promise<ActionReceipt> {
    const target = chatOf(action.targetHandle);
    if (target === null) return gone(action.type);
    const { chat, ready } = target;
    const ui = desk.ui(chat.key);
    const state = desk.session(ready.page.pageId, chat.conversationRef);
    const session = state.state === 'ready' ? state.session : null;
    const take = session?.takes.find((candidate) => candidate.takeId === action.takeId);
    if (session === null || take === undefined || take.state !== 'ready') return gone(action.type);
    // A take already handed over (seen or not) is handed again only after the person's yes: the fan would get it twice.
    const handed = (ui.attach?.takeId === take.takeId && (ui.attach.state === 'attached' || ui.attach.state === 'unknown')) || take.attached !== null;
    if (handed && action.again !== true) {
      ui.confirm = { kind: 'again', takeId: take.takeId };
      ws.bump();
      return done(action.type, 'needs-confirm');
    }
    ui.confirm = null;
    ui.error = null;
    const port = ws.ports.host.attachFile?.bind(ws.ports.host);
    if (port === undefined) return studioError(chat.key, action.type, { code: 'CG-VOICE-ATTACH' });
    if (chat.identity === null) return studioError(chat.key, action.type, { code: 'CG-GATE-CHAT-LOADING' });
    const audio = desk.audio(take.takeId);
    if (audio?.state !== 'ready') {
      desk.fetchAudio(session.sessionId, take.takeId);
      return studioError(chat.key, action.type, audio?.state === 'failed' ? audio.error : { code: 'CG-DATA-NOT-READY' });
    }
    const token = await ws.token('insert', 'dock', cause);
    if (!token.ok) return studioError(chat.key, action.type, token.error);
    const n = session.takes.indexOf(take) + 1;
    const intent: AttachIntent = {
      intentId: ids.uuid(),
      expected: chat.identity,
      cause: token.payload,
      file: { name: fileName(ws.situation().fanName, n), type: 'audio/mpeg', bytes: audio.bytes.slice(0) },
    };
    ui.attach = { takeId: take.takeId, state: 'handing', error: null };
    ws.bump();
    let receipt: AttachReceipt;
    try {
      receipt = await port(intent);
    } catch {
      receipt = { state: 'unknown' };
    }
    switch (receipt.state) {
      case 'attached':
        ui.attach = { takeId: take.takeId, state: 'attached', error: null };
        void ws.ports.rpc.request('voice.attached', { sessionId: session.sessionId, takeId: take.takeId, state: 'attached' }).then((answer) => (answer.ok ? desk.apply(answer.payload) : undefined));
        break;
      case 'unknown':
        ui.attach = { takeId: take.takeId, state: 'unknown', error: { code: 'CG-VOICE-ATTACH-UNKNOWN' } };
        void ws.ports.rpc.request('voice.attached', { sessionId: session.sessionId, takeId: take.takeId, state: 'unknown' }).then((answer) => (answer.ok ? desk.apply(answer.payload) : undefined));
        break;
      case 'not-attached':
        // The person closed the site's upload window: nothing to say. The site refused the file: the card says so.
        ui.attach = receipt.reason === 'dismissed' ? null : { takeId: take.takeId, state: 'failed', error: { code: 'CG-VOICE-ATTACH' } };
        break;
      case 'refused':
        ui.attach = { takeId: take.takeId, state: 'failed', error: { code: ATTACH_REFUSAL_CODE[receipt.reason] } };
        break;
    }
    ws.bump();
    return receipt.state === 'attached' ? done(action.type) : receipt.state === 'not-attached' && receipt.reason === 'dismissed' ? done(action.type, 'noop') : refused(ws, action.type, ui.attach?.error ?? { code: 'CG-VOICE-ATTACH' });
  }

  const handlers: ActionHandlers = {
    async ShowVoice(action, cause) {
      const target = chatOf(action.targetHandle);
      if (target === null) return gone(action.type);
      const { chat, ready } = target;
      if (!action.open) {
        if (ws.sheet(chat.key)?.kind === 'voice') ws.setSheet(chat.key, null);
        const state = desk.session(ready.page.pageId, chat.conversationRef);
        if (state.state === 'ready' && state.session !== null) void desk.save(chat.key, state.session.sessionId);
        return done(action.type);
      }
      ws.setSheet(chat.key, { kind: 'voice' });
      desk.seen(chat.key);
      const ui = desk.ui(chat.key);
      ui.error = null;
      // The chat's session as the background keeps it now; with nothing written and a draft in the field, the script
      // is written at once, by this click.
      let state = desk.session(ready.page.pageId, chat.conversationRef);
      if (state.state !== 'ready') state = await desk.read(ready.page.pageId, chat.conversationRef);
      const session = state.state === 'ready' ? state.session : null;
      const composer = ws.situation().host.composer;
      const draft = composer !== null && composer.draft.provenance !== 'empty';
      if (state.state === 'ready' && (session === null || (session.script === null && session.writing === null && session.takes.length === 0)) && draft) return write(target, ui.tone, 'field', cause, action.type);
      return done(action.type, 'opened');
    },
    WriteVoiceScript(action, cause) {
      const target = chatOf(action.targetHandle);
      if (target === null) return Promise.resolve(gone(action.type));
      const ui = desk.ui(target.chat.key);
      const state = desk.session(target.ready.page.pageId, target.chat.conversationRef);
      const session = state.state === 'ready' ? state.session : null;
      // A rewrite replaces the person's own text of the script: asked first (the old extension wiped it without a word).
      const text = session === null ? null : textOf(session, ui);
      const edited = session?.script !== null && session?.script !== undefined && text !== null && canonicalVoiceScript(text) !== canonicalVoiceScript(session.script.original);
      if (action.from === 'session' && edited && action.confirmed !== true) {
        ui.confirm = { kind: 'rewrite', tone: action.tone };
        ws.bump();
        return Promise.resolve(done(action.type, 'needs-confirm'));
      }
      return write(target, action.tone, action.from, cause, action.type);
    },
    async CancelVoiceScript(action) {
      const target = chatOf(action.targetHandle);
      if (target === null) return gone(action.type);
      const state = desk.session(target.ready.page.pageId, target.chat.conversationRef);
      const writing = state.state === 'ready' ? (state.session?.writing ?? null) : null;
      if (writing === null) return done(action.type, 'noop');
      const answer = await ws.ports.rpc.request('op.cancel', { opId: writing.opId });
      return answer.ok ? done(action.type) : refused(ws, action.type, answer.error);
    },
    EditVoiceScript(action) {
      const target = chatOf(action.targetHandle);
      if (target === null) return Promise.resolve(gone(action.type));
      const state = desk.session(target.ready.page.pageId, target.chat.conversationRef);
      const session = state.state === 'ready' ? state.session : null;
      if (session === null || session.script === null || session.writing !== null) return Promise.resolve(done(action.type, 'noop'));
      desk.edit(target.chat.key, session.sessionId, action.text);
      return Promise.resolve(done(action.type));
    },
    RevertVoiceScript(action) {
      const target = chatOf(action.targetHandle);
      if (target === null) return Promise.resolve(gone(action.type));
      const state = desk.session(target.ready.page.pageId, target.chat.conversationRef);
      const session = state.state === 'ready' ? state.session : null;
      if (session?.script === null || session === null) return Promise.resolve(done(action.type, 'noop'));
      desk.edit(target.chat.key, session.sessionId, session.script.original);
      void desk.save(target.chat.key, session.sessionId);
      return Promise.resolve(done(action.type));
    },
    async MakeVoiceTake(action, cause) {
      const target = chatOf(action.targetHandle);
      if (target === null) return gone(action.type);
      const { chat, ready } = target;
      const ui = desk.ui(chat.key);
      ui.error = null;
      const state = desk.session(ready.page.pageId, chat.conversationRef);
      const session = state.state === 'ready' ? state.session : null;
      if (session === null || session.script === null || session.writing !== null) return done(action.type, 'noop');
      const text = textOf(session, ui) ?? '';
      const issue = voiceScriptIssue(canonicalVoiceScript(text), VOICE_LIMITS.scriptMaxChars);
      if (issue !== null) return studioError(chat.key, action.type, { code: 'CG-VOICE-SCRIPT' });
      await desk.save(chat.key, session.sessionId);
      const token = await ws.token('generate', 'dock', cause);
      if (!token.ok) return studioError(chat.key, action.type, token.error);
      const answer = await ws.ports.rpc.request('voice.take', { sessionId: session.sessionId, takeId: ids.uuid(), script: text, cause: token.payload });
      if (!answer.ok) return studioError(chat.key, action.type, answer.error);
      desk.apply(answer.payload);
      if (!answer.payload.ok) return studioError(chat.key, action.type, answer.payload.error);
      return done(action.type, 'started');
    },
    SelectVoiceTake(action) {
      const target = chatOf(action.targetHandle);
      if (target === null) return Promise.resolve(gone(action.type));
      desk.ui(target.chat.key).selected = action.takeId;
      ws.bump();
      return Promise.resolve(done(action.type));
    },
    async CheckVoiceTake(action, cause) {
      const target = chatOf(action.targetHandle);
      if (target === null) return gone(action.type);
      const state = desk.session(target.ready.page.pageId, target.chat.conversationRef);
      const session = state.state === 'ready' ? state.session : null;
      if (session === null) return gone(action.type);
      const token = await ws.token('generate', 'dock', cause);
      if (!token.ok) return studioError(target.chat.key, action.type, token.error);
      const answer = await ws.ports.rpc.request('voice.check', { sessionId: session.sessionId, takeId: action.takeId, cause: token.payload });
      if (!answer.ok) return studioError(target.chat.key, action.type, answer.error);
      desk.apply(answer.payload);
      return answer.payload.ok ? done(action.type) : studioError(target.chat.key, action.type, answer.payload.error);
    },
    AttachVoiceTake: (action, cause) => attach(action, cause),
    DownloadVoiceTake(action) {
      const target = chatOf(action.targetHandle);
      if (target === null) return Promise.resolve(gone(action.type));
      const state = desk.session(target.ready.page.pageId, target.chat.conversationRef);
      const session = state.state === 'ready' ? state.session : null;
      const index = session?.takes.findIndex((take) => take.takeId === action.takeId) ?? -1;
      const audio = desk.audio(action.takeId);
      if (session === null || index < 0 || audio?.state !== 'ready') return Promise.resolve(studioError(target.chat.key, action.type, { code: 'CG-DATA-NOT-READY' }));
      const saved = ws.ports.files?.save({ name: fileName(ws.situation().fanName, index + 1), mime: 'audio/mpeg', bytes: audio.bytes }) ?? false;
      if (saved) ws.ports.toasts?.show({ kind: 'success', code: null, scope: 'voice.download', title: msg('voice.downloaded'), body: null });
      return Promise.resolve(saved ? done(action.type) : studioError(target.chat.key, action.type, { code: 'CG-UI-FAILED' }));
    },
    async NewVoice(action, cause) {
      const target = chatOf(action.targetHandle);
      if (target === null) return gone(action.type);
      const { chat, ready } = target;
      const ui = desk.ui(chat.key);
      const state = desk.session(ready.page.pageId, chat.conversationRef);
      const session = state.state === 'ready' ? state.session : null;
      // Paid takes that never reached the field, or one still rendering: the person is asked first.
      const atStake = session !== null && session.takes.some((take) => take.state === 'creating' || take.state === 'working' || (take.state === 'ready' && take.attached === null));
      if (atStake && action.confirmed !== true) {
        ui.confirm = { kind: 'new' };
        ws.bump();
        return done(action.type, 'needs-confirm');
      }
      ui.confirm = null;
      // The field's draft now makes the new script: the old session goes once the new one is admitted (the background
      // replaces it), so a refused start loses nothing.
      return write(target, ui.tone, 'field', cause, action.type);
    },
    DismissVoiceConfirm(action) {
      const target = chatOf(action.targetHandle);
      if (target === null) return Promise.resolve(gone(action.type));
      desk.ui(target.chat.key).confirm = null;
      ws.bump();
      return Promise.resolve(done(action.type));
    },
    ClearVoiceDraft(action) {
      return Promise.resolve(refused(ws, action.type, { code: 'CG-FEATURE-DISABLED' }));
    },
  };

  return createSurface(ws, {
    kinds: ['voice'],
    build,
    handlers,
    dispose() {
      if (slowTimer !== null) clock.clearTimer(slowTimer);
      slowTimer = null;
    },
  });
}

/** The MP3's name for the site and for «Скачать»: the fan and the take, nothing of the text. */
function fileName(fanName: string | null, n: number): string {
  const fan = (fanName ?? '').replace(/[^\p{L}\p{N}_-]+/gu, '').slice(0, 24);
  return `voice${fan === '' ? '' : `-${fan}`}-${String(n)}.mp3`;
}

/** A stable digest of a text the field no longer holds (the session's own draft, for a rewrite). */
function digestOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
