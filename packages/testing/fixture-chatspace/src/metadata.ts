// Fixture metadata: which observable ChatSpace contract each part of the stand
// reproduces, and where that contract was read. References name ChatSpace
// 0.172.0 modules by their short role names (as architecture.md does) with line
// numbers of the local research copy; no ChatSpace code lives in this repo.
// The stand is written from these observations, never copied.

export interface FixtureContract {
  readonly id: string;
  /** What the extension relies on (architecture.md section). */
  readonly contract: string;
  /** Stand files that reproduce it (relative to fixture-chatspace/src). */
  readonly stand: readonly string[];
  /** Where it was observed: «module:lines» of ChatSpace 0.172.0, research docs. */
  readonly observedAt: readonly string[];
}

export const CHATSPACE_VERSION_OBSERVED = '0.172.0';

export const FIXTURE_CONTRACTS: readonly FixtureContract[] = [
  {
    id: 'vue-app',
    contract: '#app.__vue_app__ with config.globalProperties.$router and .$pinia (§6.1)',
    stand: ['main.ts'],
    observedAt: ['runtime-dom:2993', 'composables:265'],
  },
  {
    id: 'router',
    contract: "route 'chat' = /accounts/:accountId/chats/:chatId?, afterEach, push (§6.1, §6.9)",
    stand: ['router.ts', 'ui/navigation.ts'],
    observedAt: ['composables:86086-86087', 'accounts:8630-8640 (chat URL builder)'],
  },
  {
    id: 'send-queue',
    contract:
      'store pendingMessages: enqueue/cancel/resend/confirmEchoedMessage/resetForAccount/resetAll, messagesByAccountId, processingByAccountId; per-account sequential queue; 30 s timeout; Mimic or 50 per chat → null; Guard → FAILED blocked; echo confirmed by plain text (§6.6, §6.7)',
    stand: ['stores/pending-messages.ts'],
    observedAt: ['notificationEntry:1304 (statuses)', 'notificationEntry:1351-1366 (POST body)', 'notificationEntry:1427-1640 (store)', 'notificationEntry:1639-1654 (composer wrapper drops isAiGenerated)'],
  },
  {
    id: 'http-client',
    contract: 'Ky-like client: request object created synchronously, fetch = options.fetch ?? globalThis.fetch.bind(globalThis) taken in its constructor; 401 → fresh token → one bare re-run; POST never retried (§6.7.6)',
    stand: ['net/http.ts', 'net/auth.ts'],
    observedAt: ['composables:63153-63160, 63223-63235 (constructor)', 'composables:86134-86142, 86155-86178 (client, 401 hook)', 'composables:62989-62999 (retry defaults)'],
  },
  {
    id: 'query-cache',
    contract: '_pc_query: getQueryData, setQueryData, invalidateQueries (refetch active only), getEntries, entries with deps/active/stale/asyncStatus; $onAction on every call (§6.1, §6.7.4 п. 7)',
    stand: ['query/cache.ts', 'query/use-query.ts'],
    observedAt: ['composables:542-776', 'composables:603-614 (invalidateQueries)', 'composables:697 (getQueryData)'],
  },
  {
    id: 'cache-keys',
    contract: '["accounts"], ["chatMessages",acc,fan], ["fansMap",acc], ["chatList",acc,filter], ["mimicSettings"], ["mimicChats"], ["userPermissions"], ["onlyfansBuyingPowers"], ["onlyfansLastPayments",acc], ["fanInsights",acc] (§6.1)',
    stand: ['query/queries.ts'],
    observedAt: ['accounts:2048', 'composables:89542-89545', 'accounts:7086-7087, 7194, 7244-7245, 8535-8536', 'accounts:6185', 'inbox:192, 234', 'composables:86182'],
  },
  {
    id: 'cache-shapes',
    contract: 'mapped account (numeric id, platformAccountId), message {id,text,createdAt,platformSenderId,isOutgoing,platform,platformMetadata}, history pages newest first, fan map entries (isBlocked, canReceiveMessages, isRestricted…)',
    stand: ['query/model.ts'],
    observedAt: ['accounts:2033-2047', 'composables:86860-86880', 'accounts:7046-7080'],
  },
  {
    id: 'accounts',
    contract: 'store accounts: subscribedAccountIds (set before subscribe_account goes out), openAccountIds, findAccount; tabEntries; chatTabEntries with newMessagesByChatId (§6.1, §6.7.5)',
    stand: ['stores/accounts.ts'],
    observedAt: ['accounts:9440-9512', 'accounts:8645-8720', 'accounts:8989-9010'],
  },
  {
    id: 'chats',
    contract: 'store chats (isFanOnline by fan id, typing), chatList socket updates and cache-only markChatAsRead, chatMessages socket upsert + confirmEchoedMessage (§6.7.3, §6.8)',
    stand: ['stores/chats.ts'],
    observedAt: ['accounts:6219-6290', 'accounts:6295-6372', 'messages:21403-21440'],
  },
  {
    id: 'translator',
    contract: "store composerTranslator, localStorage 'chat-space:composer-translator:accounts:<userId>', auto-translate = enabled && autoTranslate (§6.7.4 п. 11)",
    stand: ['stores/composer.ts'],
    observedAt: ['messages:2848-2869', 'messages:3083'],
  },
  {
    id: 'insert-payload',
    contract: 'store ofComposerInsert: setInsertPayload replaces the mounted composer draft (what insertMessage feeds)',
    stand: ['stores/composer.ts', 'ui/composer.ts'],
    observedAt: ['messages:14610-14622', 'messages:18709-18719'],
  },
  {
    id: 'composer-dom',
    contract: 'div.relative > .composer-frame.overflow-hidden > strip h-10 > [data-id="browser-composer-translator"]; one composer per visited chat tab (v-show, key tabId:acc:chat); blocked fan → hidden (§6.3)',
    stand: ['ui/composer.ts', 'ui/chat-view.ts'],
    observedAt: ['messages:5693-5755', 'messages:14928-14966, 15008-15032', 'ChatView:7860, 8253, 8274'],
  },
  {
    id: 'composer-bridge',
    contract: '__omComposerBridge {setText, insertText, focus, insertMessage}; setText escapes & < > then <br>/<p> (§6.4, §6.7.1)',
    stand: ['ui/bridge.ts'],
    observedAt: ['messages:14624-14666', 'composables:63515 (escape)'],
  },
  {
    id: 'editor',
    contract: 'TipTap editor at .ProseMirror, view.dom.editor, transaction/update events, Mod-b/i/e and Mod-Shift-s marks, Enter sends (§6.4, §9.1)',
    stand: ['ui/editor.ts'],
    observedAt: ['dist:12162-12163, 12177-12201 (editor handle, dispatch)', 'messages:1611-1628 (StarterKit config, handleKeyDown)'],
  },
  {
    id: 'draft',
    contract: "localStorage 'chat-space:draft:of:{acc}:{fan}' = {body: TipTap JSON + attachments, updatedAt}, written by a watcher, 30-day TTL (§6.1)",
    stand: ['ui/bridge.ts'],
    observedAt: ['composables:89696-89720'],
  },
  {
    id: 'global-hotkeys',
    contract: "Esc 'lastResort' closes the chat tab unless input/textarea focus or a visible [data-dismissible-open]/dialog/listbox/menu; registered on window (capture) at layout mount (§9.1)",
    stand: ['ui/hotkeys.ts', 'ui/layout.ts'],
    observedAt: ['MainLayout:331-333', 'composables:89854-89880'],
  },
  {
    id: 'alt-s',
    contract: 'Alt+S (by code, any modifiers) toggles the translator in a capture listener on the composer root; Alt+A swallowed (§9.1)',
    stand: ['ui/composer.ts'],
    observedAt: ['messages:18364-18373'],
  },
  {
    id: 'message-list',
    contract: 'message list keeps the bottom on resize (or its anchor when scrolled up) (§6.3)',
    stand: ['ui/chat-view.ts'],
    observedAt: ['messages:19905-19913'],
  },
  {
    id: 'theme',
    contract: '--color-om-* RGB triplets inline on <html>, .dark/.light class, --app-content-max-width/align for fixed width (§6.1, §6.3)',
    stand: ['ui/theme.ts', 'styles.css'],
    observedAt: ['index:886-898', 'fanCardSettings:1368-1372, 1437, 1623-1624', 'MainLayout:303'],
  },
  {
    id: 'socket',
    contract: "one socket per connect (new on every reconnect), handlers as properties, frames {event, account, message}; actions auth/subscribe_account/unsubscribe_account with the token; 'authenticated' (§6.7.5, §6.8)",
    stand: ['net/socket.ts', '../../src/stand/socket-hub.ts'],
    observedAt: ['composables:85389 (URL)', 'composables:86274-86283 (new WebSocket, onmessage)', 'composables:86366-86425 (bus)', 'composables:86428-86465 (actions, events)', 'accounts:6356-6368, messages:21415-21428 (frame fields)'],
  },
];
