// Telegram's contract report (docs/specs/2026-10-27-telegram-site.md §6.5, §11 «Telegram changes Web A's markup»): the
// state of each anchor of Web A the adapter reads, and of each capability. An anchor that goes missing while a chat is
// open turns what needs it off, and the tab's health report names it; the dock stays off where the page is not what
// the adapter knows.

import type { CapabilityState, HostCapability } from '@cg/contracts/host';
import type { TelegramAnchorId, TelegramContractReport } from '@cg/contracts/telegram-host';

/** The Telegram adapter's version in its report. */
export const TELEGRAM_ADAPTER_VERSION = '0.1.0';

type AnchorState = 'ok' | 'missing' | 'shape' | 'notYet';

export interface TelegramContractInput {
  /** The active slot's session entry named a user id. */
  readonly account: boolean;
  /** The address names a person's chat (`#<id>`). */
  readonly personRoute: boolean;
  /** `.messages-layout` is in the page. */
  readonly layout: boolean;
  readonly listSlide: boolean;
  readonly headerPeer: boolean;
  readonly messageList: boolean;
  /** The main field under the list slide: the editor, its stub (`notYet`), or none. */
  readonly field: 'editor' | 'stub' | 'none';
  readonly composer: boolean;
  readonly adapterVersion: string;
  readonly checkedAt: number;
}

const ON: CapabilityState = { state: 'on' };
const off = (reason: string): CapabilityState => ({ state: 'off', reason });
const notReady = (reason: string): CapabilityState => ({ state: 'off', reason, code: 'CG-HOST-NOT-READY' });
const broken = (reason: string): CapabilityState => ({ state: 'contractBroken', reason, code: 'CG-HOST-CONTRACT' });
const NO_FIELD: CapabilityState = { state: 'off', reason: 'field', code: 'CG-HOST-COMPOSER-MISSING' };

export function buildTelegramReport(input: TelegramContractInput): TelegramContractReport {
  // A chat's anchors are looked for only on a person's chat route: elsewhere (no chat, a group, the settings) they are
  // not there by design.
  const chatAnchor = (present: boolean): AnchorState => (!input.personRoute || !input.layout ? 'notYet' : present ? 'ok' : 'missing');
  const anchors: Record<TelegramAnchorId, AnchorState> = {
    layout: !input.personRoute ? 'notYet' : input.layout ? 'ok' : 'missing',
    listSlide: chatAnchor(input.listSlide),
    headerPeer: chatAnchor(input.headerPeer),
    messageList: chatAnchor(input.messageList),
    field: !input.personRoute || !input.listSlide ? 'notYet' : input.field === 'editor' ? 'ok' : input.field === 'stub' ? 'notYet' : 'missing',
    composer: !input.personRoute || !input.listSlide ? 'notYet' : input.composer ? 'ok' : 'missing',
    account: input.account ? 'ok' : 'missing',
  };
  const identity = input.account ? ON : notReady('account');
  const gone = (state: AnchorState): boolean => state === 'missing' || state === 'shape';
  const chat = gone(anchors.listSlide) ? broken('listSlide') : gone(anchors.headerPeer) ? broken('headerPeer') : identity;
  const list = gone(anchors.messageList) ? broken('messageList') : chat;
  const field = gone(anchors.field) || gone(anchors.composer) ? NO_FIELD : chat;
  const capabilities: Record<HostCapability, CapabilityState> = {
    identity,
    route: ON,
    accounts: identity,
    dockMount: gone(anchors.composer) ? NO_FIELD : ON,
    insert: field,
    draftRead: field,
    chatWindow: list,
    // The chat goes to the hub as the transcript itself (`clientContext`), never as fresh page text.
    freshText: off('clientContext'),
    fan: chat,
    chatList: off('site'),
    sendObserve: off('site'),
    incoming: list,
    navigate: off('site'),
    theme: ON,
    previewSend: off('site'),
    receipt: off('site'),
    fileAttach: off('site'),
    chatHeader: off('site'),
  };
  return {
    host: 'telegram-web',
    build: null,
    adapterVersion: input.adapterVersion,
    checkedAt: input.checkedAt,
    capabilities,
    extensions: { 'telegram-web': { anchors, capabilities: { transcript: list } } },
  };
}
