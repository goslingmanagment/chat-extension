# Telegram Web as the third site: Reply, Fix and Coach in Lora's Telegram

Status: v4, 2026-10-28, after two arena rounds (astra and Opus 5.5, max; every decisive claim re-checked against the
code and telegram-tt) and the owner's answers. Two repositories: the hub (`~/code/1-platform/hub`) and this extension.

## 1. Goal

The model persona Lora talks with fans in Telegram (her account, opened at `https://web.telegram.org/a/` in Firefox).
Fans write in Russian and English, ask about her videos, flirt. We want the same ChatGoose dock as on Fansly, cut down
to three features: **Reply** (an answer to the fan in Lora's voice, with tones), **Fix** (polish what the chatter
typed) and **Coach** (the chatter asks the AI for advice on this conversation; its proposed messages can go into the
field).

The owner's decisions (2026-10-27/28):
- Who: the owner first (pilot), then the chatters who work Lora's Telegram.
- Reply writes warm talk and flirting only. It never sells: no offers, prices, PPV, tiers, subscriptions, links or
  payment details. Tones: casual, flirty, spicy (spicy stays).
- Fix polishes the chatter's own text. A price, an offer, a promise or a payment detail the chatter wrote stays as
  written; Fix adds none of its own.
- Coach advises the chatter, selling included: the sale is the human's job. Its proposed fan messages may carry an
  offer; it never invents a price (a number only when the chatter gave it or it is already in the chat).
- Her name: the AI answers to whatever name the fan uses and never corrects him (a fan on the screenshot calls her
  «Саша»).
- Work in Lora's Telegram counts in the chatter's shifts, as on the other sites.
- Only Lora's Telegram account. Its user id is read with the tg CLI (`get_me` of the park's `lora-persona`,
  `@loraviexen`; no chat read) and becomes the hub page's account id; the live check and the pilot confirm the tab
  reports the same id (§4.1).
- Agents may log into two of the agency's own park accounts (for example `alina` and `yulya`) in Telegram Web for live
  checks, open only the chat between them and write only there (§10): these are HR accounts with real candidates.
  Agents never open Lora's live Telegram.

Success:
1. In Lora's Telegram Web, a private chat with a person shows the same dock as on Fansly with Reply, Fix and Coach only.
2. Reply puts a reply into Telegram's field: Lora's voice, the fan's language, consistent with the chat. Fix rewrites
   the draft in the field. Coach answers the chatter's question about this chat. Nothing is ever sent without the
   human pressing Telegram's Send; no key pressed in our UI ever reaches Telegram.
3. Reply never sells; Fix keeps the chatter's own offer and payment details verbatim and adds none; Coach never invents
   a price.
4. ChatSpace and Fansly behave exactly as before; released clients (older versions of this extension, fansly-chat, the
   onlyfans-chat desktop app) keep signing in and working; no forced update for anyone; chatters without a Telegram
   page see no change at all.
5. The owner uses it in the pilot and says it is good; then the chatters get it.

## 2. Scope

In:
- Telegram Web A only (`https://web.telegram.org/a/*`), Firefox only.
- Private one-to-one chats with a person, in the main message field. Not groups, channels, bots, Saved Messages,
  Telegram's service accounts (777000, 489000, 1271266957, 2666000), forum topics, threads, pinned or scheduled views,
  the quick preview window.
- The shared dock (the same look as on Fansly) with Reply, Fix and Coach and the dock's hotkeys for them. Coach without
  Review, Recap and the archive refresh (the hub has no Telegram archive).
- «Включить Telegram» in the popup, an optional host permission, shown only to a person whose bootstrap has a Telegram
  page and whose hub serves Telegram.
- Works only when the active Telegram account (§4.1) is bound to a hub page granted to the person. On any other account
  (a chatter's personal one, a second account in the same browser) the extension shows nothing and sends nothing.
- In Lora's account the dock shows in every private chat with a person, the team's chats (folders «Чатеры», «Трафик»)
  included: nothing leaves the browser without a click.

Out:
- Hi, Ping, Review, voice, notes, Recap, Spenders, «Онлайн», «Новые», «Рассылка», the palette ⌘K, Chat Memory, the fan
  panel. Navigation between chats (Alt+1–9, J, K, ⌘U and alike).
- Media to the AI (photos, videos): labels in the transcript only.
- Telegram Web K (`/k/`), the Telegram desktop app, other models' Telegram accounts.
- Reading more history than Telegram rendered: the extension never scrolls a chat by itself.
- How chatters get into Lora's Telegram (login codes, sessions): the owner's call, outside the extension.

## 3. Approach and why

Chosen: **Telegram is a third site.** A light adapter in the extension reads the open chat from the page and inserts
text into the field; the hub gets a new platform `telegram`, a page for Lora's Telegram and a Telegram persona.

Rejected: *Telegram through Lora's Fansly page* (mixes spend and fan data with Fansly, ties Telegram to Fansly's
`drafts` switch, needs special binding and the prompt branch anyway); *drafts through the tg CLI* (no buttons in
Telegram, useless for chatters); *Lora's Telegram connected to OnlyMonster ChatSpace*, which lists Telegram accounts
(`telegram_v2`, `docs/research/onlymonster-chatspace.md`): her session would sit with a third party and that
integration is early.

## 4. How it works

```
web.telegram.org/a/ (Lora's tab)
  isolated content script (host-telegram), no MAIN script
    reads: the active account's user id (§4.1), the open chat (§4.2), the rendered messages (§4.3),
           the draft in the main field
    writes: text into the main field (§4.4), nothing else; holds every key pressed in our UI (§4.5)
        │ tab protocol
  background (+ bg/telegram.ts: Telegram's feature slice only)
    binds the account id to the hub page `lora-tg` (platform `telegram`)
    builds fast-reply / improve-draft / coach-chat with clientContext (the transcript)
        │ HTTPS
  hub
    checks: page granted, `telegram` allows only these three features, clientContext and fanRef present
    prompt: the Telegram persona + Telegram template slots (§7), streams the text back
```

### 4.1 Whose account

Web A keeps several accounts in one browser: the active one is the URL's `?account=N` (N > 1; none means 1), and its
session lives in `localStorage` under `account<N>` (telegram-tt `src/util/accountSlot.ts`, `src/util/multiaccount.ts`).
The legacy `user_auth` key follows slot 1 only and is never used. The adapter reads only the `userId` field of the
active slot's entry, through a port from the entry point (the packages' lint forbids `localStorage`, as on ChatSpace);
nothing else of Telegram's storage is read, kept or logged (auth keys sit next to it). Missing, unreadable or empty
because of a passcode (the session store is then in memory only): no identity, no dock, nothing read. The account is
read again before every start and every insert; a change stops both.

### 4.2 Which chat

- Two roots, both the active slide of their own `Transition` (Web A keeps the previous chat as a hidden slide in each;
  its own selector, `EDITABLE_INPUT_CSS_SELECTOR` in `src/config.ts`, does the same):
  - the list and the field: `.messages-layout > .Transition > .Transition_slide-active`;
  - the header, a sibling of that `Transition` with its own (`MiddleColumn.tsx`, `MiddleHeader.tsx`):
    `.messages-layout > .MiddleHeader > .Transition > .Transition_slide-active .ChatInfo .Avatar[data-peer-id]`.
  Any `.Avatar[data-peer-id]` elsewhere (the chat list) is never read. While either root has no active slide (an
  animation), nothing starts and nothing is inserted until it settles.
- The hash must be `^#\d+$` (a person). Any suffix (`_thread`, `_pinned`, `_scheduled`) or negative id: no dock.
- Before a start and before an insert, the hash's id must equal the header root's peer id.
- Chat changes are seen by a DOM observer of the middle column (Web A changes the hash by `pushState`, with no
  `hashchange`). The quick preview (`#portals`) is never read.
- Not the account itself, not a service id (§2); bots by the header's «bot» status, best effort.

### 4.3 The transcript

- Source: the active slide's message list. Web A opens a chat around the last read message and keeps at most 80 or 120
  messages in the DOM, so the newest message may be missing: without `.list-bottom-marker` the dock warns «Прокрутите к
  последним сообщениям», a start still works on what is rendered, the transcript ends with
  `--- newer messages are not loaded ---`, and the result carries the same warning. A warning, not a block.
- Window: everything rendered (at most 120 messages). The hub cuts it to the owner's live limits, the same ones its
  archive lane obeys (`aiTranscriptMaxMessages` for Reply and Fix, `aiCoachTranscriptMaxMessages` for Coach; 25 and 50
  on prod on 2026-10-28; `services/ai-transcript-depth.ts`): it keeps the last N message lines with their day lines,
  recounts `messageCount` and notes the cut in the manifest. `transcriptCoverage: "window"` only while
  `.list-bottom-marker` is rendered; without it the field is not sent.
- Lines: `[HH:MM] Fan:` / `Model:` (`.Message.own` is Lora's), the day lines as the page shows them
  (`--- Today ---`, `--- Saturday ---`, `--- October 18 ---`), the minutes as the page shows them, made 24-hour. No
  `transcriptClock`: the hub then dates its «Now:» line and says the times are the device's
  (`modules/ai/features/index.ts`). The full date is not in the DOM (the time's `title` appears only on mouseenter)
  and the page is never touched to get it.
- Text: from the message's text node with emoji taken from `<img class="emoji" alt>`; time, «edited» and reactions
  left out. A message being sent (a fractional `data-message-id`) is left out. A translated chat is marked
  «(translated by Telegram)».
- Labels: `[Photo]`, `[Video]`, `[Album]`, `[Voice message]`, `[Sticker 😘]` or `[Sticker]`, `[Call]`; a reply quote
  from `.EmbeddedMessage` becomes `(replying to: «…»)`; `.ActionMessage` lines are skipped. An empty chat sends
  `No conversation history.`
- The texts live in memory only, are freed with the request, and are never stored, logged or sent anywhere but the hub.
- The adapter reports each new incoming message as a fact, as the other sites do, so a cached answer goes stale
  (`packages/core/src/domain/ops/cache.ts`).

### 4.4 The insert

- The field is TipTap 3 / ProseMirror. Until the editor loads, a stub with the same id and no `contenteditable` stands
  there: the insert waits for the editor, as an insert waits for a field on the other sites. In the edit mode of a sent
  message (`.ComposerEmbeddedMessage` with the edit icon) the dock warns «Вы редактируете отправленное сообщение» (a
  warning, not a block). While the attachment window is open the main field is inactive and the caption is another
  field (`Composer.tsx`, `editable-message-text-modal`): the answer is generated but not inserted, with «Окно вложения
  открыто: вставьте текст в подпись сами или закройте окно» and «Копировать».
- The write: a Range selection inside the field's `contenteditable`, then `execCommand('insertText')` line by line,
  with `insertParagraph` between lines; never a `value` or `innerHTML` write. After it the text is read back and
  compared; TipTap's input rules (`--` to a dash, `*x*`, `**x**`, `<<`, `>>`) are checked live (§10) and, if they
  bite, the affected characters are inserted so the rules do not fire.
- Fansly's guarantees apply as they are (`packages/host-fansly/src/isolated/insert.ts`): the target (account, chat)
  frozen at the start and checked again after focus; the draft's digest checked before writing; replacing text the
  human typed asks first; a write that may have half-happened is uncertain and never retried by itself.
- The fan's script check before an insert (`fanScript`) reads the transcript's fan lines.
- **Payment details.** When the draft under Fix holds a token that looks like a wallet, a card, an IBAN, a link or an
  amount, and Fix's result does not hold the same token character for character, the dock warns «Реквизиты
  изменились, сверьте» before the insert. A warning the chatter can pass, not a block.

### 4.5 Keys

Web A listens to `keydown` on `document` in the capture phase (`src/components/middle/composer/MessageInput.tsx`): a key
whose target is not its field, an input, a textarea or a `contenteditable` sends the field on Enter or ⌘/Ctrl+Enter and
moves any other key into the field. A key in our closed shadow root reaches `document` with our host as its target, so
**Enter in Coach's question box would send the field to the fan**, and a plain letter would move focus into Telegram's
field so that the next Enter sends (it has no `isComposing` check, so IME input too). host-telegram adds its own
`keydown`/`keypress`/`keyup` listener on `window` in the capture phase at `document_start`, ahead of the shared
dispatcher (whose early exits for plain keys and IME, `packages/core/src/application/hotkeys/dispatcher.ts`, come
before its isolation): every key whose path starts in our root is stopped there and delivered as a copy inside our root
(`packages/host-kit/src/isolated/keyboard.ts` already does this for our own keys). Typing inside our fields stays
normal; nothing is `preventDefault`ed that need not be. Our shortcuts on Telegram: Reply ⌘E and Fix ⌘I win over Telegram's code and italic; apply-fix
⌘↵ takes the key only while a Fix result is on screen, otherwise it stays Telegram's send. Absent features are listed
in `keyRules.absent` so their keys stay Telegram's (⌘K link, ⌘⇧M monospace).

## 5. Hub changes (one PR, deployed before the extension)

1. **Platform `telegram`.** Migration: one row into `platforms` (`pages.platform` is text with a foreign key), with
   the `-- agency-hub:rollback-compatible` header; additive. Widen the platform lists and every per-platform map the
   typecheck flags (`packages/shared/src/types.ts`, `PLATFORM_KEYS`, `BINDING_REVISION`, `PromptPlatform`, the
   dashboard labels and alike). The two closed platform CHECKs (`ai_media_descriptions`, `publication_dispatches`) stay:
   Telegram never writes there. `pnpm contracts:generate`, artifacts committed (CI checks them).
2. **What the typecheck will not flag, listed:** `telegram` rows for `insertion`, `drafts` and `coach` in
   `CLIENT_FEATURE_REQUIREMENTS` (`client-features.ts`); `STAR_ROW_PLATFORMS` not widened; the `clientContext` guard
   (`modules/ai/features/index.ts`, today Fansly only) becomes Fansly or Telegram; the per-platform AI allowlist (item
   6); `applyPlatformWording` for Telegram; the pins in `tests/client-token-scopes.test.ts`. About 360 branches of the
   form `=== "fansly"` / `!== "onlyfans"` exist: the PR greps them and says which ones Telegram goes through.
3. **Sync kind, said outright.** A small table: OnlyFans `legacy`, Fansly `engine`, Telegram `none` (Fansly's adapter
   declares no streams either, so "no streams" is not the test). `/health/sync`, the sync summary, the owner's overview,
   sync status and agent fields skip the sync checks for `none` and say «синхронизация не нужна»; Fansly keeps every
   engine check. The revenue views leave the Telegram page out (it has no revenue).
4. **Telegram pages stay out of the closed-enum responses.** The responses of `me` and `GET /pages` (and any other the
   grep finds with the closed platform enum) leave `telegram` pages out for every device token; the dashboard's cookie
   session sees everything. The password login's `user` leaves them out for everyone (the dashboard reads its pages
   through its cookie `me` right after). The filter sits at the response's serialization, never in the principal
   (`canAccessPage` must keep working for the extension's AI). The bootstrap is untouched: its `platform` is an open
   token, older extensions skip an unknown one, and this extension takes its pages from it (`packages/hub/src/facade.ts`
   uses `me` for the user id alone). The check: the existing `tests/client-sdk-compat.integration.test.ts`, which runs
   every frozen SDK (20 builds of three clients) against the hub, gets a Telegram page assigned in its fixture; no new
   test file.
5. **Page and persona creation.** Two audited CLI commands, run by the agent on agency-de (the persona admin route
   needs an owner session the agent does not have):
   - `persona put --key lora-telegram --display-name «Лора · Telegram» --from-file <text>`;
   - `page add telegram --model <lora> --label lora-tg --display-name «Лора · Telegram» --account-id <tg user id>
     --proxy-from lora-1 --persona lora-telegram`: the page (no transactions, no sync), its `external_page_id` (never
     changed after; checked before), the AI gateway proxy copied (the gateway refuses a page without one), and its
     default persona.
   The bootstrap's page gets an optional `defaultPersonaKey` (an open, additive field): the extension assigns it to an
   unassigned page and warns «Для этой страницы задумана персона …» when someone picks another. No refusal.
6. **Only Reply, Fix and Coach.** A per-platform AI allowlist in the client AI switch and again in the AI route (full
   device tokens skip the switch): `telegram` allows `fast-reply`, `improve-draft`, `coach-chat`. There the route
   requires `clientContext` and `fanRef` (the fan's Telegram user id), refuses `clientContext.media`,
   `draftPurpose: "outreach"` and the `upsell` tone. The page's own row in `chatExtensionFeatures` switches on `drafts`,
   `coach` and `insertion`; `splitAll` stays off; every other flag reads `platform_unsupported`. No new flag. Coach's
   recap lookup finds nothing for the page and needs no change.
7. **Capability.** `telegram-ai-v1` in `SERVED_CLIENT_CAPABILITIES` and `CLIENT_HUB_CAPABILITY_NAMES`: the extension
   offers Telegram only against a hub that serves it.
8. **Prompts** (§7).
9. **No forced update.** `chatExtensionMinVersion` stays as it is (unset on prod): it is one minimum for every site.
10. **Rollback.** A rollback during the deploy itself is safe (no Telegram page exists yet). Once the page exists the
    hub is never rolled back past this release; a broken deploy is fixed forward (an older image fails `me` and login
    for anyone assigned the page, deleted or not, and its revenue overview reads deleted pages).

## 6. Extension changes (two PRs after the hub is deployed: Reply and Fix first, then Coach)

1. **Re-vendor the SDK** with the hub's own script from a clean hub checkout at the deployed commit
   (`node scripts/vendor-sdk.mjs <worktree>/vendor/kernel-sdk`, run in the hub); check `sourceCommit`. `telegram` joins
   `KNOWN_PLATFORMS`. The bootstrap page's `defaultPersonaKey` (§5.5) is assigned to an unassigned page, with the
   warning when someone picks another (`packages/core/src/application/ai/environment.ts`).
2. **The clientContext path, end to end.** Today no site sends `clientContext` (`packages/contracts/src/hub/ai.ts`), and
   the internal schemas are strict. Telegram's AI policy produces the snapshot (§4.3) → `AiStartFields` → `StartOp` →
   the request builder (`packages/core/src/domain/ops/request.ts`) → the hub body (`platform: 'telegram'`,
   `clientContext`), never beside `liveTextContext`, `livePpvContext`, `liveImages`, `coverageCheck` or `draftMedia` (the
   hub answers 400; Telegram's `HostPort` has no `readDraftMedia`). Which sites send
   it is data (a per-platform table), never a site name in shared code. The op's identity
   (`packages/core/src/domain/ops/identity.ts`) includes a digest of the context it sends, so a changed window makes a
   new request, never the cached answer. Fansly's and ChatSpace's paths stay as they are. The fake hub checks the body
   against the vendored SDK's schema and gets the Telegram rules (`fake-hub/ai-rules.ts`).
3. **Site access for more than one optional site.** `composition/site-access.ts` and `background.ts` hold one optional
   site (`OPTIONAL_HOST = 'fansly-web'`); it becomes a per-site table: access, script sets, tab hosts, origins, feature
   slices, the popup control and the settings row, each site with its own switch (today `siteActive`/`siteOn` treat
   every site but Fansly as always on, `background.ts`). Fansly's own services stay in Fansly's row and are not
   generalized: the relay page, the `fansly.` prefix, the network session, the freshness hook, the notice tabs. Fansly's
   behaviour stays exactly as it is. Telegram's popup control and settings row appear only under the condition in §2.
4. **The registry:** `scripts.main` becomes optional; `hosts/telegram.ts` and `hosts/runtime/telegram.ts` describe
   Telegram: matches `https://web.telegram.org/a/*` (check `web_accessible_resources` with that path), optional
   permission, one dynamic isolated script; the lazy build has the dock, navigation, AI, `ai-analysis` and `ai-coach`,
   tab health, tab protocol and app, texts, and on demand coach, dialogs and the expanded result. `bg/telegram.ts` is a
   background module that only brings Telegram's feature slice (the core's table keeps sites' slices out of the core
   graph; its row is null as Fansly's). The early key route reads the hash too (`composition/tab/adapter.ts` sees the
   pathname only). Whether open tabs get the script without a reload is settled in the PR (`createScriptTabs` wants a
   notice file).
5. **`packages/host-telegram`** (isolated world only): identity (§4.1), chat (§4.2), transcript (§4.3), draft and insert
   (§4.4), keys (§4.5), the dock mount through host-kit, theme, a contract probe of its anchors, `hotkeyClient:
   'extension'`. `HostPort` members Telegram does not use (cached chats, navigate, preview send) are empty or null;
   `HOST_SEND_ATTRIBUTION_SOURCE` is null. The activity heartbeat runs as on the other sites, so the work counts in
   shifts. The tab's diagnostics line shows the active account's id and «не привязан к странице» when no page matches,
   so the pilot can check the id.
6. **Feature slice and tones.** Telegram's slice has `reply` and `fix` (PR 1) and `coach` with the Coach window's
   surface (PR 2), so the dock shows exactly those. The tone list becomes per site, in data (today one `TONES` list
   feeds the menu and ⌘⇧O, `packages/core/src/domain/features/tone.ts`): Telegram has casual, flirty, spicy. Its own
   dock variant `telegram`, styled as Fansly's.
7. **Coach (PR 2).** The window's Review chip, recap tick, «Собрать Recap», recap windows and «Обновить переписку» show
   only when the site's slice and the page have them (today `coach/controller.ts` and `ui/src/overlays/coach` draw some
   of them for every site); on Telegram the depth chip is absent (`vm.depth = null`) and Coach shows the snapshot's
   size and time instead of the archive's freshness; «Coach хочет дочитать» never appears (the hub's `more` block is on
   the archive lane only).
   Each Coach question takes a new snapshot; history, chips and the insert of its drafts are the shared ones.
8. **Lists the typecheck will not check:** `SITE_REPORT_HOSTS`, `DOCK_VARIANTS`, `PLATFORM_TITLES`, the settings'
   sites section, `tools/gates/manifest.test.ts`, `NOTE_SITES` in `tools/release/changes.ts`.
9. **Gates and lint:** site paths, the site-name gate (shared code never names Telegram, Telegram's code never names
   the other sites), dependency-cruiser rules for the new package, the manifest slice table, archive check, host
   contract check (a stub for Telegram).
10. **Stand and `pnpm see`:** `packages/testing/fixture-telegram` on a third loopback name (`telegram.localhost` or alike,
    checked in Firefox; `127.0.0.2` does not bind on macOS), built on TipTap like the ChatSpace stand, with Web A's
    slides, list, bottom marker, day labels, header avatar and its `document` key listener that sends on Enter. The fake
    hub gets the Telegram page. `pnpm see --site telegram` scenarios: Reply, Fix, Coach, and on the same stand letters
    then Enter typed in Coach's question box (focus stays ours, nothing is sent), the chat switched during a generation,
    the draft edited during it, the list scrolled up, the attachment window open, an unbound account, payment details
    changed by Fix. No new e2e spec.
11. **`pnpm see --live --site telegram`** for the live checks of §10: a park account's Telegram Web in the see profile,
    the test build against the fake hub with a page bound to that account's id.
12. **AGENTS.md (this repo):** the red line: agents never open Lora's live Telegram (opening a chat marks it read, her
    fans are real); live checks only on two park accounts, opening only the chat between them by its hash, logging out
    of Telegram Web after (never «terminate all sessions»: that kills the tg CLI's session), the see profile outside the
    repo; no key from our UI ever reaches Telegram.

Anchors on Web A (telegram-tt `6002824b`, the same build web.telegram.org serves on 2026-10-27): the active slide and
its header avatar's `data-peer-id`; the field `#editable-message-text` inside it; `.Message.message-list-item`, `.own`,
`data-message-id`; `.message-date-group` sticky labels; `.message-time`; `.list-bottom-marker`; `.EmbeddedMessage`;
`.ActionMessage`; `.ComposerEmbeddedMessage`; the slot's `?account=` and `localStorage` `account<N>`. CSS-module
classes are hashed in the build: only global classes are anchors.

## 7. Prompts for Telegram (hub)

- **A Telegram persona as data**: a new `ai_personas` row `lora-telegram`, «Лора · Telegram», written by the agent from
  `builtin:lora` and shown to the owner in the hub PR. Her voice, facts, boundaries and her catalog (customs, sexting,
  GFE and the rest, as knowledge Coach needs) stay; every instruction to offer goes ("What you offer" as an instruction,
  "Prices", "Making offers", tier perks, the offering lines of "Your approach to fans" and "Reading the room": HOT soft
  offer, BUYER); Telegram is no longer an "outside contact", while the face, meetings and the other limits stay; she
  answers to whatever name the fan uses and never corrects it. One code line: her local time in `PERSONA_LOCAL_TIME`
  (`persona-local-time.ts`). The owner can edit it in the dashboard like any persona. The page names it as its
  default persona (§5.5): the extension assigns it and warns when someone picks another.
- **Per-platform template slots** (as Ping's already are), so OnlyFans and Fansly prompts stay byte for byte (the
  existing prompt checks):
  - Reply (`fast-reply.md`): the "don't ignore buying signals" line becomes, on Telegram:

> You're chatting in your own Telegram private messages; he already has your Telegram, talking here is normal.
> This chat is only for warm talk and flirting. Never sell: no offers, no prices, no PPV, no tiers, no subscriptions,
> no links, no payment details. If he asks about videos, prices or buying, answer warmly and briefly, ask what exactly
> he likes, and never name a price, list videos or promise one: that part is for later. Never promise your face, a
> meeting or a call.

  - Fix (`improve-draft.md`): "The draft is the chatter's: keep its offer, price and promise in meaning, translated like
    the rest when the fan writes another language; keep every number, currency, link and payment detail character for
    character; add no offer, price or link of your own." The prompt echo shows the mixed case (a Russian draft with a
    price for an English-speaking fan).
  - Coach (`coach-chat.md`): its first line becomes a sales coach for a model's Telegram chats; "name the price to
    quote" becomes "say when to name a price: the chatter sets it, and a number appears only when the chatter gave it
    or it is already in the chat"; no PPV, vault, tiers or subscriptions exist here.
  - The rest of the "OnlyFans" wording goes through `applyPlatformWording`; the PPV-tag line can stay (Telegram
    transcripts have none).
- The hub PR shows the whole final prompt of each of the three features on a Telegram page (the prompt echo).

## 8. Safety

- The extension never sends, and no key from our UI reaches Telegram (§4.5).
- It reads only the active slide of the chat the person opened; never another chat, never scrolls, never navigates.
  Opening a chat marks it read in Telegram: that is the person's own click.
- Inserting text makes Telegram show «печатает…» to the fan and saves a cloud draft, visible in every session of
  Lora's account: someone else working her account at the same moment sees the inserted text in their field.
- On an account with no granted page no chat content and no id leave the browser; under the existing consent the tab's
  health report (site kind, anchors, counts, no ids, no text) may.
- Agents: never Lora's live Telegram; live checks on two park accounts only, opening and writing only the chat between
  them.

## 9. Rollout

1. Hub PR → merge → deploy to agency-de → health → Lora's user id from the tg CLI → create the page `lora-tg`, switch
   its row on (`drafts`, `coach`, `insertion`) and add the persona row `lora-telegram` (§5.5). The owner's approval of
   this spec covers these three prod data changes; assigning the page to chatters waits for the pilot. The Telegram
   persona is a copy of `builtin:lora` (revision 3 on 2026-10-28): later edits of Lora's persona do not reach it.
2. Extension PR 1 (site, Reply, Fix) → live check (§10) → merge → green main → `pnpm release`, one release at a time
   with the other sessions. `No chatter note: owner-only pilot; chatters without a Telegram page see no change`; a
   release without notes posts nothing. After the release, its SDK goes into the hub's client SDK registry as for every
   release (`tools/release/gate.ts`).
3. Pilot: the owner turns on «Включить Telegram» and works in her Telegram (the page's persona comes by default).
4. Extension PR 2 (Coach) → the same path.
5. Chatters: after the owner's OK, `user assign-page` per chatter (no version raise). The chatter note, with
   `telegram` in `NOTE_SITES` and addressed to those who work Lora's Telegram, goes in the first PR after the pilot (its
   fixes); its release posts it.

## 10. Checks and showing the result

- Locally: typecheck, lint and the touched tests in each repo; `pnpm contracts:generate` in the hub; the rest is CI.
- No new test files: the hub's existing SDK compat suite gets a Telegram page in its fixture (§5.4).
- Shown: the `pnpm see --site telegram` scenarios on the stand, next to the same dock on Fansly.
- Live, first thing in extension PR 1, before the rest is polished: an agent logs into a park account's Telegram Web
  (code or QR via the tg CLI), opens only the chat with the other park account by its hash, and checks that the CSP (no `moz-extension:` in `script-src`, `img-src`, `font-src`) lets our
  lazy chunks, the dock's images and fonts load; the anchors hold; Enter in our UI sends nothing; the insert lands in
  the editor's model with line breaks and without TipTap's rewrites; a second account (`?account=2`) gets no dock. The
  only chat opened or written to is the one between the two park accounts; afterwards it logs out of Telegram Web.

## 11. Risks and how we notice

| Risk | What we do |
|---|---|
| A key in our UI sends the field | Every key from our root held on `window` (§4.5); a stand scenario and the live check. |
| The wrong chat or account | Active slide only, hash checked against the header's peer id, the active slot's id (§4.1, §4.2). |
| Telegram changes Web A's markup (it deploys often) | The contract probe hides the dock when an anchor is missing and the tab health report names it; fix the adapter. |
| An old window or a stale answer | The bottom marker gate, incoming-message facts and the context digest in the op identity (§4.3, §6.2). |
| The insert misses the editor model or gets rewritten | Read back after writing; the first live check; uncertain, never retried. |
| Fix changes a wallet address | The verbatim check warns before the insert (§4.4). |
| An old client meets a Telegram page | Never in closed-enum responses (§5.4), covered by the compat suite. |
| A hub rollback after the page exists | Never past this release; fix forward (§5.10). |
| The AI sells in Reply | The Telegram persona, the Reply slot and the refused `upsell` tone; the pilot reads the replies. |
