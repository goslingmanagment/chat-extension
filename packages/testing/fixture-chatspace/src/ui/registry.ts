// What the test-control API can ask the rendered UI: mounted composers and
// the open message list. Components register themselves; nothing here is a
// ChatSpace contract.

import type { ComposerSnapshot, MessageListState } from '../protocol';
import type { OmEditor } from './editor';

export interface MountedComposer {
  readonly root: HTMLElement;
  readonly tabId: string;
  readonly accountId: string;
  readonly chatId: string;
  readonly editor: () => OmEditor | null;
  readonly slot: () => HTMLElement | null;
  readonly shown: () => boolean;
}

const composers = new Map<string, MountedComposer>();
let messageList: (() => MessageListState) | null = null;

export function registerComposer(key: string, composer: MountedComposer): void {
  composers.set(key, composer);
}

export function unregisterComposer(key: string): void {
  composers.delete(key);
}

export function composerSnapshots(): ComposerSnapshot[] {
  return [...composers].map(([key, composer]) => ({
    key,
    tabId: composer.tabId,
    accountId: composer.accountId,
    chatId: composer.chatId,
    shown: composer.shown(),
    hasBridge: composer.slot() !== null && '__omComposerBridge' in (composer.slot() ?? {}),
    hasEditor: composer.editor() !== null,
  }));
}

export function findComposer(accountId: string, chatId: string): MountedComposer | null {
  const matches = [...composers.values()].filter((composer) => composer.accountId === accountId && composer.chatId === chatId);
  return matches.find((composer) => composer.shown()) ?? matches[0] ?? null;
}

export function registerMessageList(read: (() => MessageListState) | null): void {
  messageList = read;
}

export function messageListState(): MessageListState | null {
  return messageList?.() ?? null;
}
