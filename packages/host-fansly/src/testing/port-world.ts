// Fansly's HostPort on a Fansly-like page over a scripted MAIN, for the DOM
// tests of its writes (test-only; nothing that ships imports it; R20 P7e). MAIN
// knows the creator from the start and answers every focus of the route with
// the group's fan — the way P7b's MAIN does once the page told it the group —
// a task later. The background's `token.redeem` is a stand-in the test turns
// off; a load by the address is recorded, never made. And the browser's
// `document.execCommand('insertText')`, which happy-dom has not: it replaces
// the selection and fires `beforeinput` and `input` as Firefox does — or, on
// request, does nothing, half of it, or writes with no event.

import { fanslyChatWire, fanslyIdentityWire } from '@cg/contracts/fixtures';
import type { HostEvent, InsertIntent, InsertWire, NavigationIntent } from '@cg/contracts/host';
import type { DraftSnapshot, HostIdentity } from '@cg/contracts/ids';

import { createAnchorWatcher } from '../isolated/anchors';
import { createFanslyHostPort, type FanslyDiagnostic, type FanslyPort } from '../isolated/host-port';
import { createFanslyMounts } from '../isolated/mount';
import { createRouteWatcher } from '../isolated/route';
import { loadValidation } from '../isolated/validation';
import { createFakeFanslyPage, type FakeFanslyPage } from './fake-dom';
import { EPOCH, NO_ONE, scriptedMain } from './scripted-main';

export { EPOCH };

/** How the stand-in editor command behaves: as Firefox's, or one of the ways a write can go wrong. */
export type EditorMode = 'firefox' | 'noop' | 'partial' | 'silent' | 'throws';

let editor: EditorMode = 'firefox';
/** The editor commands asked so far, their text. */
export const editorCalls: string[] = [];

export function setEditor(mode: EditorMode): void {
  editor = mode;
}

/** Firefox's `insertText` on a focused textarea: the selection replaced, `beforeinput` and `input`, the caret after the text. */
export function installEditor(doc: Document = document): () => void {
  const command = (name: string, _ui?: boolean, text = ''): boolean => {
    editorCalls.push(text);
    const field = doc.activeElement;
    if (name !== 'insertText' || !(field instanceof HTMLTextAreaElement)) return false;
    if (editor === 'throws') throw new Error('no editor');
    if (editor === 'noop') return false;
    const start = field.selectionStart;
    const end = field.selectionEnd;
    const written = editor === 'partial' ? text.slice(0, Math.ceil(text.length / 2)) : text;
    if (editor !== 'silent') field.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: written }));
    field.value = `${field.value.slice(0, start)}${written}${field.value.slice(end)}`;
    field.setSelectionRange(start + written.length, start + written.length);
    if (editor !== 'silent') field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: written }));
    return true;
  };
  Object.defineProperty(doc, 'execCommand', { value: command, configurable: true, writable: true });
  return () => {
    Reflect.deleteProperty(doc, 'execCommand');
    editor = 'firefox';
    editorCalls.length = 0;
  };
}

/** Lets the port, the observers and the bridge's promises run. */
export const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

export const until = async (what: string, predicate: () => boolean, ms = 3000): Promise<void> => {
  const end = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > end) throw new Error(`not in ${ms} ms: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const light = { current: () => ({ scheme: 'light', tokens: {}, fixedWidth: false }) as const, onChange: () => () => undefined, dispose: () => undefined };

export interface WorldOptions {
  /** The fan of each group MAIN names on a focus; a group not here is a group chat. */
  readonly fans: Readonly<Record<string, string>>;
  /** The groups whose DM rules are not met. */
  readonly copyOnly?: readonly string[];
  readonly navInsertTimeoutMs?: number;
}

export interface World {
  readonly port: FanslyPort;
  readonly page: FakeFanslyPage;
  readonly events: HostEvent[];
  readonly diagnostics: FanslyDiagnostic[];
  /** The tokens spent, by kind. */
  readonly redeemed: string[];
  /** Pages loaded by their address (SP-036's fallback). */
  readonly loads: string[];
  allowRedeem(allowed: boolean): void;
  /** The next `token.redeem` waits until the returned release is called (an answer of the background still on its way). */
  holdRedeem(): () => void;
  /** MAIN stops naming fans for a while (its answer waits), or names them again. */
  holdChats(held: boolean): void;
  identity(): HostIdentity;
  draft(): Promise<DraftSnapshot>;
  /** An open intent from a draft read (now, or one read before); its consent when asked for. */
  intent(text: string, options?: { readonly from?: DraftSnapshot; readonly mode?: 'replace' | 'append'; readonly confirm?: boolean; readonly ttlMs?: number }): Promise<InsertIntent>;
  /** «Открыть и вставить» to a group's fan (or a plain navigation without text). */
  navigation(groupId: string, text?: string, options?: { readonly ttlMs?: number; readonly fanId?: string; readonly account?: string }): NavigationIntent;
  dispose(): void;
}

const TOKEN = 'tok_unit_world_0000000';
const uuid = (): string => crypto.randomUUID();

/** The port on a Fansly-like page at `path`, its creator known, once its first state was taken. */
export async function startWorld(path: string, options: WorldOptions): Promise<World> {
  history.replaceState({}, '', path);
  const page = createFakeFanslyPage();
  const diagnostics: FanslyDiagnostic[] = [];
  const redeemed: string[] = [];
  const loads: string[] = [];
  let allowed = true;
  let held = false;
  let redeemGate: Promise<void> | null = null;
  let batch = 0;
  const waiting: Array<() => void> = [];
  const main = scriptedMain({
    'fx.state': () => ({ ...NO_ONE, identity: fanslyIdentityWire }),
    'fx.ack': () => null,
    'fx.focus': (payload: never) => {
      const { groupId, routeEpoch } = payload as { readonly groupId: string | null; readonly routeEpoch: number };
      if (groupId === null) return null;
      const fanId = options.fans[groupId] ?? null;
      const name = (): void => {
        batch += 1;
        main.batch(batch, { t: 'fx.chat', p: { ...fanslyChatWire, groupId, routeEpoch, fanId, kind: fanId === null ? 'group' : 'direct', dmAllowed: !(options.copyOnly ?? []).includes(groupId) } });
      };
      setTimeout(() => (held ? waiting.push(name) : name()), 0);
      return null;
    },
  });
  const route = createRouteWatcher(window, (diagnostic) => diagnostics.push(diagnostic));
  const anchors = createAnchorWatcher(document, route);
  const port = createFanslyHostPort({
    win: window,
    bridge: main.client,
    mounts: createFanslyMounts(document),
    theme: light,
    route,
    anchors,
    redeem: (request) => {
      redeemed.push(request.kind);
      const gate = redeemGate;
      redeemGate = null;
      return gate === null ? Promise.resolve(allowed) : gate.then(() => allowed);
    },
    validation: loadValidation,
    ...(options.navInsertTimeoutMs === undefined ? {} : { navInsertTimeoutMs: () => options.navInsertTimeoutMs }),
    load: (where) => loads.push(where),
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  const events: HostEvent[] = [];
  port.subscribe((event) => events.push(event));
  await port.ready;
  await settle();

  const identity = (): HostIdentity => {
    const now = port.identity();
    if (now === null) throw new Error('no identity');
    return now;
  };
  return {
    port,
    page,
    events,
    diagnostics,
    redeemed,
    loads,
    allowRedeem: (next) => void (allowed = next),
    holdRedeem() {
      let release = (): void => undefined;
      redeemGate = new Promise((resolve) => (release = resolve));
      return release;
    },
    holdChats(next) {
      held = next;
      if (!held) for (const name of waiting.splice(0)) name();
    },
    identity,
    draft: () => port.readDraft(identity()),
    async intent(text, over = {}) {
      const draft = over.from ?? (await port.readDraft(identity()));
      const base = draft.identity;
      if (base.chat === null || base.composerInstanceId === null) throw new Error('no open field');
      const now = Date.now();
      return {
        intentId: uuid(),
        operationId: uuid(),
        part: { index: 0 },
        target: base.chat,
        expected: { kind: 'open', documentEpoch: base.documentEpoch, routeEpoch: base.routeEpoch, composerInstanceId: base.composerInstanceId, draftRevision: draft.revision, draftDigest: draft.digest },
        mode: over.mode ?? 'replace',
        text,
        confirmationId: over.confirm === true ? uuid() : null,
        createdAt: now,
        expiresAt: now + (over.ttlMs ?? 10_000),
        cause: { kind: 'click', actionToken: TOKEN },
      };
    },
    navigation(groupId, text, over = {}) {
      const account = over.account ?? fanslyIdentityWire.creatorId;
      const fanId = over.fanId ?? options.fans[groupId] ?? '700000000000000099';
      const now = Date.now();
      const thenInsert: InsertWire | undefined =
        text === undefined
          ? undefined
          : {
              intentId: uuid(),
              operationId: uuid(),
              part: { index: 0 },
              target: { host: 'fansly-web', hostAccountId: account, platformFanId: fanId },
              expected: { kind: 'deferred', documentEpoch: EPOCH },
              mode: 'replace',
              text,
              confirmationId: null,
              createdAt: now,
              expiresAt: now + (over.ttlMs ?? 10_000),
            };
      return { intentId: uuid(), cause: { kind: 'click', actionToken: TOKEN }, target: { hostAccountId: account, platformFanId: fanId, conversationRef: groupId }, ...(thenInsert === undefined ? {} : { thenInsert }) };
    },
    dispose() {
      port.dispose();
      page.destroy();
    },
  };
}
