// Composer-side stores (metadata.ts «translator», «insert-payload»):
// - composerTranslator: per-account settings in localStorage
//   `chat-space:composer-translator:accounts:<userId>`; auto-translate on Send
//   = enabled && autoTranslate;
// - ofComposerInsert: payloads a mounted composer applies by REPLACING its
//   draft (what the bridge's insertMessage feeds).

import { defineStore } from 'pinia';
import { computed, ref, type WritableComputedRef } from 'vue';

import { storeId } from '../env';
import { record } from '../journal';
import { currentUserId } from '../net/auth';
import type { ComposerContent } from './pending-messages';
import { storedRef } from './stored';

export const TRANSLATOR_STORAGE_PREFIX = 'chat-space:composer-translator:accounts:';

export interface TranslatorAccountSettings {
  readonly enabled: boolean;
  readonly autoTranslate: boolean;
  readonly sourceLang: string | undefined;
  readonly targetLang: string;
}

const defaults = (): TranslatorAccountSettings => ({ enabled: false, autoTranslate: true, sourceLang: undefined, targetLang: 'EN' });

export const useComposerTranslator = defineStore(storeId('composerTranslator'), () => {
  const byAccount = storedRef<Record<string, Partial<TranslatorAccountSettings>>>(`${TRANSLATOR_STORAGE_PREFIX}${currentUserId()}`, () => ({}));
  const getAccountSettings = (accountId: string): WritableComputedRef<TranslatorAccountSettings> =>
    computed({
      get: () => ({ ...defaults(), ...byAccount.value[accountId] }),
      set: (next) => {
        byAccount.value[accountId] = next;
        record('translator-settings', { accountId, enabled: next.enabled, autoTranslate: next.autoTranslate });
      },
    });
  return { getAccountSettings };
});

export const useOfComposerInsert = defineStore(storeId('ofComposerInsert'), () => {
  const payloadsByChatKey = ref<Record<string, ComposerContent>>({});
  const copiedMessage = ref<ComposerContent | null>(null);
  const chatKey = (accountId: string, chatId: string): string => `${accountId}:${chatId}`;
  const setInsertPayload = (accountId: string, chatId: string, payload: ComposerContent): void => {
    payloadsByChatKey.value[chatKey(accountId, chatId)] = payload;
  };
  const clearInsertPayload = (accountId: string, chatId: string): void => {
    delete payloadsByChatKey.value[chatKey(accountId, chatId)];
  };
  const getInsertPayload = (accountId: string, chatId: string): ComposerContent | null => payloadsByChatKey.value[chatKey(accountId, chatId)] ?? null;
  return { payloadsByChatKey, copiedMessage, setInsertPayload, clearInsertPayload, getInsertPayload };
});
