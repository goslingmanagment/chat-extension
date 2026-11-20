// fansly-viewer: the corner card and the rest of our page-layer hosts go under Fansly's windows (2026-11-20,
// host-fansly mount.ts). While a window of Fansly's or its side menu is open, Fansly fixes its <body>; a host of ours in
// <html> painted over the whole body, the window included (Max's picture: the card over the viewer's play row). On the
// stand (fixture-fansly modal.ts holds the body as Fansly does):
// 1. the card on the chat page;
// 2. the media viewer: at the point of each control of the player (its track, play, volume, time, repeat, the gear,
//    full screen) and of the author's row the hit element is the page's, never a host of ours;
// 3. ⌘⇧M: Spenders over the viewer (our windows stay above Fansly's);
// 4. the viewer closed: the card where it stood, and a click on its «Spenders» row opens Spenders;
// 5. Wallet history with the board's bar and a row's highlight («show on the site»), then a window of Fansly over them;
// 6. the side menu over the card and the bar;
// 7. /creator/vault: the vault's collapsed entry steps aside while the viewer is open, and comes back.
// `layers.json`: each point with what stands there, the body's position, where each host of ours lives and its box.
//
// --live (`CG_SEE_LIVE_PATH=/creator/vault`): the card; a video of the vault in the viewer (the first album's first
// card), the same points; its full-screen icon; Esc. No chat is opened, nothing is sent. The side menu is a narrow
// window's (the avatar top left): by hand in `pnpm see:session fansly --live`.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { $, $$, browser } from '@wdio/globals';

import { callFansly, openFanslyStand } from '../../support/fansly-stand';
import { oursExists, readOurs } from '../../support/ours';
import { scenario, type See } from '../kit';
import { LIVE } from '../live';
import { FRAME_BAR, REPORT_PULSE, findInFrame, launcherButton, layerShown, markBox, pointFrames, reportRow, waitBar } from '../report';

const LAUNCHER = 'div[data-host="overlay"][data-layer="launcher"]';
/** The player's footer (`app-videojs-player`, main:14872) and the viewer's author row (the stand's). */
const CONTROLS: Readonly<Record<string, string>> = {
  track: '.video-track-wrapper',
  play: '.play-button-small',
  volume: '.volume-control',
  time: '.play-time',
  repeat: '.repeat',
  gear: '.quality-control',
  fullscreen: '.icon-container',
  author: '.media-author',
};

interface Point {
  readonly name: string;
  readonly x: number;
  readonly y: number;
}
interface Hit extends Point {
  /** What stands there: `ours:<layer>` for a host of ours, else the page's element. */
  readonly hit: string;
  readonly ours: boolean;
}

/** What stands at each point (a closed root answers with its host). */
async function hitsAt(points: readonly Point[]): Promise<Hit[]> {
  return browser.execute((list: Point[]) => {
    const say = (node: Element | null): { hit: string; ours: boolean } => {
      if (node === null) return { hit: 'nothing', ours: false };
      const host = node.getAttribute('data-host');
      if (host !== null) return { hit: `ours:${node.getAttribute('data-layer') ?? host}`, ours: true };
      const classes = [...node.classList].slice(0, 2);
      return { hit: `${node.localName}${classes.length === 0 ? '' : `.${classes.join('.')}`}`, ours: false };
    };
    return list.map((point) => ({ ...point, ...say(document.elementFromPoint(point.x, point.y)) }));
  }, points as Point[]);
}

/** The centres of the player's controls in the window of Fansly's on top (the track also near its left end, under the card). */
async function controlPoints(): Promise<Point[]> {
  return browser.execute((controls: Record<string, string>) => {
    const scope = document.querySelector('.active-modal') ?? document.querySelector('app-media-modal, app-media-browser-modal') ?? document;
    const points: { name: string; x: number; y: number }[] = [];
    for (const [name, selector] of Object.entries(controls)) {
      const node = scope.querySelector(selector);
      const box = node?.getBoundingClientRect();
      if (box === undefined || box.width === 0 || box.height === 0) continue;
      points.push({ name, x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) });
      if (name === 'track') points.push({ name: 'track-left', x: Math.round(box.left + 40), y: Math.round(box.top + box.height / 2) });
    }
    return points;
  }, CONTROLS as Record<string, string>);
}

/** The centre of an element (of the page, or a host of ours); null — none, or not on screen. */
async function centreOf(selector: string): Promise<{ x: number; y: number } | null> {
  return browser.execute((css: string) => {
    const box = document.querySelector(css)?.getBoundingClientRect();
    return box === undefined || box.width === 0 ? null : { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
  }, selector);
}

/** The body as Fansly left it, and where each host of ours stands. */
async function layers(): Promise<Record<string, unknown>> {
  return browser.execute(() => {
    const hosts = [...document.querySelectorAll<HTMLElement>('div[data-host]')].map((host) => {
      const box = host.getBoundingClientRect();
      return {
        host: host.getAttribute('data-host'),
        layer: host.getAttribute('data-layer'),
        parent: host.parentElement?.localName ?? null,
        z: getComputedStyle(host).zIndex,
        shown: host.style.display !== 'none' && box.width > 0,
        box: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
      };
    });
    const body = getComputedStyle(document.body);
    return { body: { position: body.position, top: body.top, classes: document.body.className }, fullscreen: document.fullscreenElement?.localName ?? null, hosts };
  });
}

/** Waits until Fansly holds (or releases) its body. */
async function bodyHeld(held: boolean, timeout = 10_000): Promise<void> {
  await browser.waitUntil(async () => (await browser.execute(() => getComputedStyle(document.body).position === 'fixed')) === held, {
    timeout,
    interval: 100,
    timeoutMsg: held ? 'Fansly did not hold its body' : 'Fansly did not release its body',
  });
}

/** One line per step in the run's output: which points our hosts took. */
function say(step: string, hits: readonly Hit[]): void {
  const taken = hits.filter((hit) => hit.ours).map((hit) => `${hit.name}→${hit.hit}`);
  console.log(`cg-see viewer ${step}: ${taken.length === 0 ? 'nothing of ours at the points' : `OURS at ${taken.join(', ')}`}`);
}

/** The bottom left corner: the card, the author's row and the player's row (the chatters' note shows it). */
const corner = (height: number): { x: number; y: number; width: number; height: number } => ({ x: 0, y: height - 450, width: 720, height: 450 });

async function onStand(s: See, facts: Record<string, unknown>): Promise<void> {
  const height = await browser.execute(() => window.innerHeight);
  await s.ready();
  await pointFrames(s);
  await s.ready();
  await browser.waitUntil(async () => (await reportRow(LAUNCHER)).shown, { timeout: 30_000, interval: 300, timeoutMsg: 'the card has no fifth row «Отчёт»' });
  const card = await centreOf(LAUNCHER);
  if (card === null) throw new Error('no corner card');
  const cardPoint: Point = { name: 'card', ...card };
  facts['1-card'] = { layers: await layers(), hits: await hitsAt([cardPoint]) };
  await s.shot('card');
  await s.shot('card-corner', { clip: corner(height) });

  // The media viewer over the chat: every control of the player is the page's.
  await callFansly('setMediaViewer', true);
  await bodyHeld(true);
  await s.wait(400);
  const viewerHits = await hitsAt([cardPoint, ...(await controlPoints())]);
  say('viewer', viewerHits);
  // The stand's page does not scroll: a body held at a scroll (`top: -400px`, as Fansly's feed) must not move the card.
  const scrolledCard = await browser.execute((css: string) => {
    const was = document.body.style.top;
    document.body.style.top = '-400px';
    const box = document.querySelector(css)?.getBoundingClientRect();
    document.body.style.top = was;
    return box === undefined ? null : { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
  }, LAUNCHER);
  facts['2-viewer'] = { layers: await layers(), hits: viewerHits, cardWithBodyAt400: scrolledCard };
  await s.shot('viewer');
  await s.shot('viewer-corner', { clip: corner(height) });

  // ⌘⇧M: Spenders over the viewer.
  await s.keys(...s.PANEL, 'm');
  await browser.waitUntil(() => oursExists('modal', '.cg-root'), { timeout: 20_000, interval: 200, timeoutMsg: 'Spenders did not open over the viewer' });
  await s.wait(1200);
  facts['3-spenders'] = { layers: await layers() };
  await s.shot('spenders-over-viewer');
  await s.closeAll();

  // The viewer closed: the card is where it stood, and its row opens Spenders.
  await callFansly('setMediaViewer', false);
  await bodyHeld(false);
  await s.wait(300);
  const back = await hitsAt([cardPoint]);
  await launcherButton(LAUNCHER, 'spenders').click();
  await browser.waitUntil(() => oursExists('modal', '.cg-root'), { timeout: 20_000, interval: 200, timeoutMsg: 'the card\'s «Spenders» did not open Spenders' });
  facts['4-closed'] = { layers: await layers(), hits: back, cardOpensSpenders: true };
  await s.wait(1200);
  await s.shot('card-opens-spenders');
  await s.closeAll();

  // Wallet history: the board's bar and a row's highlight, then a window of Fansly over them.
  await launcherButton(LAUNCHER, 'report').click();
  await browser.waitUntil(layerShown, { timeout: 30_000, interval: 200, timeoutMsg: 'the board did not show' });
  await findInFrame('#…5305');
  await waitBar(/Сверка/);
  await browser.waitUntil(async () => (await markBox()) !== null, { timeout: 30_000, interval: 300, timeoutMsg: 'no row framed' });
  await s.wait(900);
  const bar = await centreOf(FRAME_BAR);
  const barButton = await browser.execute((css: string) => {
    const host = document.querySelector(css);
    return host === null ? null : { x: Math.round(host.getBoundingClientRect().right - 50), y: Math.round(host.getBoundingClientRect().top + 22) };
  }, FRAME_BAR);
  const mark = await markBox();
  const lifted = await centreOf(LAUNCHER);
  const walletPoints: Point[] = [
    ...(lifted === null ? [] : [{ name: 'card', ...lifted }]),
    ...(bar === null ? [] : [{ name: 'bar', ...bar }]),
    ...(barButton === null ? [] : [{ name: 'bar-button', ...barButton }]),
    ...(mark === null ? [] : [{ name: 'highlight', x: Math.round(mark.x + mark.width / 2), y: Math.round(mark.y + mark.height / 2) }]),
  ];
  facts['5-wallet'] = { layers: await layers(), hits: await hitsAt(walletPoints) };
  await s.shot('wallet-bar');
  await callFansly('setMediaViewer', true);
  await bodyHeld(true);
  await s.wait(400);
  const walletHits = await hitsAt(walletPoints);
  say('wallet + viewer', walletHits);
  facts['5-wallet-viewer'] = { layers: await layers(), hits: walletHits };
  await s.shot('wallet-viewer');
  await callFansly('setMediaViewer', false);
  await bodyHeld(false);
  facts['5-wallet-after'] = { bar: await waitBar(/Сверка/), hits: await hitsAt(walletPoints) };

  // The side menu over the card and the bar.
  await callFansly('setSideMenu', true);
  await bodyHeld(true);
  await s.wait(400);
  const menuHits = await hitsAt(walletPoints);
  say('side menu', menuHits);
  facts['6-side-menu'] = { layers: await layers(), hits: menuHits };
  await s.shot('side-menu');
  await callFansly('setSideMenu', false);
  await bodyHeld(false);

  // The vault: its collapsed entry steps aside from the player's corner while the viewer is open.
  await openFanslyStand('/creator/vault');
  const entered = await browser
    .waitUntil(() => oursExists('panel', '.cg-vault__entry'), { timeout: 30_000, interval: 300 })
    .then(() => true)
    .catch(() => false);
  if (!entered) {
    facts['7-vault'] = { entry: 'none on /creator/vault' };
    console.log('cg-see viewer vault: no entry on the vault page, step skipped');
    return;
  }
  const entryVisibility = () => readOurs('panel', '.cg-vault__entry', (node) => getComputedStyle(node).visibility);
  const entryBox = await readOurs('panel', '.cg-vault__entry', (node) => {
    const box = node.getBoundingClientRect();
    return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
  });
  const vaultCard = await centreOf(LAUNCHER);
  const width = await browser.execute(() => window.innerWidth);
  const vaultCorner = { x: width - 560, y: height - 280, width: 560, height: 280 };
  facts['7-vault'] = { entry: await entryVisibility() };
  await s.shot('vault-entry', { clip: vaultCorner });
  await callFansly('setMediaViewer', true);
  await bodyHeld(true);
  await s.wait(400);
  const vaultHits = await hitsAt([...(vaultCard === null ? [] : [{ name: 'card', ...vaultCard }]), ...(entryBox === null ? [] : [{ name: 'entry', ...entryBox }]), ...(await controlPoints())]);
  say('vault + viewer', vaultHits);
  facts['7-vault-viewer'] = { entry: await entryVisibility(), hits: vaultHits, layers: await layers() };
  await s.shot('vault-viewer');
  await s.shot('vault-viewer-corner', { clip: vaultCorner });
  await callFansly('setMediaViewer', false);
  await bodyHeld(false);
  await s.wait(300);
  facts['7-vault-after'] = { entry: await entryVisibility() };
}

/** fansly.com, the test model's vault: the card, then a video of hers in the viewer. */
async function onLive(s: See, facts: Record<string, unknown>): Promise<void> {
  // No dock on the vault page: the card says the tab is ours.
  await $(LAUNCHER).waitForExist({ timeout: 60_000, timeoutMsg: 'no corner card on the page' });
  await s.wait(1500);
  const height = await browser.execute(() => window.innerHeight);
  const card = await centreOf(LAUNCHER);
  const cardPoint: Point[] = card === null ? [] : [{ name: 'card', ...card }];
  facts['1-card'] = { path: await browser.execute(() => location.pathname), layers: await layers(), hits: await hitsAt(cardPoint) };
  await s.shot('card');

  // The first album, then its first card: Fansly's viewer opens over the page.
  const album = await $('.vault-album');
  if (await album.isExisting()) {
    await album.click();
    await $('.render-container').waitForExist({ timeout: 20_000 }).catch(() => undefined);
  }
  const [first] = await $$('.render-container').getElements();
  if (first !== undefined) await first.click();
  const opened = await browser
    .waitUntil(() => browser.execute(() => document.body.classList.contains('modal-opened')), { timeout: 15_000, interval: 200 })
    .then(() => true)
    .catch(() => false);
  if (!opened) {
    facts['2-viewer'] = { opened: false };
    console.log('cg-see viewer live: no window of Fansly opened; open a video by hand in `pnpm see:session fansly --live`');
    await s.shot('no-viewer');
    return;
  }
  await s.wait(2000);
  const viewerHits = await hitsAt([...cardPoint, ...(await controlPoints())]);
  say('live viewer', viewerHits);
  facts['2-viewer'] = { opened: true, modal: await browser.execute(() => document.querySelector('.active-modal')?.localName ?? null), layers: await layers(), hits: viewerHits };
  await s.shot('viewer');
  await s.shot('viewer-corner', { clip: corner(height) });

  // The player's own full screen: the browser's top layer, nothing of ours in it.
  const expand = await $('.active-modal app-videojs-player .icon-container i');
  if (await expand.isExisting()) {
    await expand.click();
    await s.wait(1500);
    facts['3-fullscreen'] = { element: await browser.execute(() => document.fullscreenElement?.localName ?? null), layers: await layers() };
    await s.shot('fullscreen');
    await browser.execute(() => (document.fullscreenElement === null ? undefined : document.exitFullscreen()));
    await s.wait(800);
  } else facts['3-fullscreen'] = { element: 'no full-screen icon (not a video?)' };

  await browser.keys(s.Key.Escape);
  await bodyHeld(false, 10_000).catch(() => undefined);
  await s.wait(600);
  facts['4-closed'] = { layers: await layers(), hits: await hitsAt(cardPoint) };
  await s.shot('closed');
}

scenario(
  'fansly-viewer',
  async (s) => {
    const facts: Record<string, unknown> = {};
    try {
      if (LIVE) await onLive(s, facts);
      else await onStand(s, facts);
    } finally {
      writeFileSync(join(s.out, 'layers.json'), `${JSON.stringify(facts, null, 2)}\n`);
    }
  },
  {
    sites: ['fansly'],
    timeout: 240_000,
    before: async ({ hub }) => {
      await hub.command({ op: 'config', patch: { report: { ...REPORT_PULSE } } });
    },
  },
);
