// Boot of the Fansly-like stand page (R20 P6a; docs/project-unite/architecture.md §13, plan.md row P6a): our own
// Angular-like app on its own loopback name (`localhost`; ChatSpace's stand is `127.0.0.1`), with the structure and
// lifecycle of fansly.com's chat. No Fansly code, no real data. `main:N` is a line of the formatted bundle
// `main.2e6b96097a4bb73b.js` (~/Documents/Codex/fansly-web-bundle-2026-10-12/pretty/); the DOM follows its live
// skeleton (live/dom-skeleton.json) and docs/research/fansly/chat-dom-2026-10-13.json.
//
// What it reproduces, and from where:
// - routes: `/messages` and `/messages/:groupId` under one `app-messages-route`; the conversation route is reused,
//   its container, composer and the header's contact block are made anew on every chat change, the header root
//   survives; a cached group re-creates them in the same task, an uncached one after `GET /group/<id>/`
//   (conversation.ts; main:74543-74566, :74723-74724, S2 Q4, Q6); the router calls the history instance's own
//   methods at call time and reads `popstate` a task later (router.ts; main:105913-105956, :117251-117366);
// - without an address change: the contact block and the avatar while the partner count is not 1 (main:74512); the
//   gallery swaps the chat header and the container for its own (main:74527-74541); the composer's DM-rule branch —
//   `div.no-dm-allowed` and `div.message-composer.hidden` — and its voice button turning into «Stop recording»
//   (composer.ts; template main:56271, main:55759-55790); the composer's field branch can also be re-created on its
//   own (control `recreateField`): what a change of its `mode` would do — the narrow observer of
//   architecture.md §7.3 must survive it, though the bundle does it for neither the DM rules nor the voice;
// - the composer: `textarea` with NgModel — the model is sent, not the field; the cached draft and the clearing after
//   a send come by a microtask without events; Enter by the component's own Shift flag; `POST /message` created and
//   sent synchronously inside the Enter keydown or the Send click; Send keeps the focus; typing at most every 3 s
//   (composer.ts, ng.ts; main:55791-56265, :114424-114429);
// - the upload modal and `app-account-media-create-template` in `div.message-attachments` after «Upload»;
//   `body.modal-opened` while a modal is open (modal.ts; main:42635-42646, :54064-54074, :55951-55975);
// - the list: «typing» line (`div.partner-is-typing`, 3.1 s); bottom rules — 1 px for size changes, 350 px for new
//   messages — and `scrollTop = 0` loading the page before (container.ts, scroll.ts; main:59153-59266,
//   :24538-24550);
// - the virtual inbox of `<a href="/messages/<id>">` rows, 20 per page, ±1.5 heights rendered (inbox.ts;
//   main:73686-73690, :73822-73868);
// - the mini-chat with its own container and composer outside the route (mini-chat.ts; main:59914, :61744-61745);
// - `bright-theme` / `dark-theme` on `<html>` (theme.ts; main:52583-52597, styles:2, :257);
// - the old extension's four marks (old-extension.ts; fansly-chat 2.10.x);
// - for FBuddy's MAIN script, Angular's view registry with the root view in it (ng.ts `registerView`).
// Its data come from the fake Fansly (R20 P6b, packages/testing/src/fake-fansly) when the stand server names one in
// the page's `<meta>` tags: real XHR requests (http.ts, xhr-backend.ts) and a real socket (socket.ts), wired by
// live.ts. Without it — a DOM test, `?stand-backend=local` — the page answers itself from its in-page world
// (backend.ts). FBuddy is not the page's: the stand server puts the FBuddy-like neighbour (R20 P6d,
// src/fake-fansly/neighbor) in front of this script when a test asks. The vault (`/creator/vault`, vault.ts, R20
// P13a): albums, an open album's cards and «Upload to Vault» with the page's own input, over the fake Fansly only.

import './styles.css';

import { createStandApp } from './app';
import { installControl } from './control';
import { record } from './journal';
import type { ServerConfig } from './live';
import { FANSLY_STAND_PARAMS, FANSLY_STAND_READY_ATTRIBUTE } from './protocol';
import { FANSLY_SERVER_META } from './server-protocol';
import { setTheme } from './theme';

/** Where the stand server says the fake Fansly is; undefined — nowhere (the page answers itself). */
function serverConfig(params: URLSearchParams): ServerConfig | undefined {
  if (params.get(FANSLY_STAND_PARAMS.backend) === 'local') return undefined;
  const meta = (name: string): string => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? '';
  const config: ServerConfig = { apiOrigin: meta(FANSLY_SERVER_META.api), socketUrl: meta(FANSLY_SERVER_META.socket), token: meta(FANSLY_SERVER_META.token) };
  return config.apiOrigin === '' || config.socketUrl === '' || config.token === '' ? undefined : config;
}

const positive = (value: string | null): number | undefined => {
  const parsed = Number(value);
  return value !== null && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

function boot(): void {
  const params = new URLSearchParams(location.search);
  setTheme(params.get(FANSLY_STAND_PARAMS.theme) === 'dark' ? 'dark' : 'bright');
  const mount = document.querySelector<HTMLElement>('app-root') ?? document.body.appendChild(document.createElement('app-root'));
  const latency = Number(params.get(FANSLY_STAND_PARAMS.latency));
  const server = serverConfig(params);
  const pingInterval = positive(params.get(FANSLY_STAND_PARAMS.ping));
  const ackDelay = positive(params.get(FANSLY_STAND_PARAMS.ackDelay));
  const app = createStandApp(mount, {
    ...(Number.isFinite(latency) && latency > 0 ? { latency } : {}),
    ...(server !== undefined ? { server, live: { ...(pingInterval !== undefined && pingInterval > 0 ? { pingInterval } : {}), ...(ackDelay !== undefined ? { ackDelay } : {}) } } : {}),
  });
  const control = installControl(app);
  app.start(() => {
    if (params.get(FANSLY_STAND_PARAMS.oldExtension) === '1') app.oldMarks.set(true);
    const mini = params.get(FANSLY_STAND_PARAMS.miniChat);
    if (mini !== null && mini !== '') app.miniChat.open(mini);
    control.markReady();
    document.documentElement.setAttribute(FANSLY_STAND_READY_ATTRIBUTE, '1');
  });
}

try {
  boot();
} catch (error) {
  record('boot-failed', { message: error instanceof Error ? error.message : String(error) });
  document.documentElement.setAttribute(FANSLY_STAND_READY_ATTRIBUTE, 'failed');
}
