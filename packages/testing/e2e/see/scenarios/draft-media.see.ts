// Reply sees the media attached to the message being written: a photo put into the open chat's composer the person's
// way (ChatSpace: dropped on the composer; Fansly: picked in its file input, then «Upload» in its window; `--live`: a
// photo and a video of the test model's vault), then Reply. `hub-calls.json` shows the `draftMedia` the start carried:
// each medium's kind and its picture as JPEG. `--showcase` also cuts the chatters' picture (`draft-media-<site>.png`).

import { browser } from '@wdio/globals';

import { around, scenario, type See } from '../kit';
import { LIVE } from '../live';

/** A sunset over the sea, drawn in the page as a JPEG file and handed to the composer as the person's own file would be. */
async function attachPhoto(site: 'chatspace' | 'fansly'): Promise<void> {
  await browser.execute(async (where: string) => {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1200;
    const g = canvas.getContext('2d') as CanvasRenderingContext2D;
    const sky = g.createLinearGradient(0, 0, 0, 700);
    sky.addColorStop(0, '#2b1e5c');
    sky.addColorStop(0.6, '#e8566c');
    sky.addColorStop(1, '#f9a65a');
    g.fillStyle = sky;
    g.fillRect(0, 0, 900, 700);
    g.fillStyle = '#ffd36e';
    g.beginPath();
    g.arc(450, 640, 120, 0, Math.PI * 2);
    g.fill();
    const sea = g.createLinearGradient(0, 700, 0, 1200);
    sea.addColorStop(0, '#24507a');
    sea.addColorStop(1, '#0d2238');
    g.fillStyle = sea;
    g.fillRect(0, 700, 900, 500);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b as Blob), 'image/jpeg', 0.9));
    const files = new DataTransfer();
    files.items.add(new File([blob], 'sunset.jpg', { type: 'image/jpeg' }));
    if (where === 'chatspace') {
      const zone = document.querySelector('[data-stand-composer]') as HTMLElement;
      for (const type of ['dragenter', 'drop']) zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: files }));
      return;
    }
    const input = document.querySelector('app-messages-conversation-route app-group-message-input .collapsable-actions > input[type=file]') as HTMLInputElement;
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, site);
  if (site === 'fansly') {
    // The upload window's own «Upload» (a button on fansly.com, a plain node on the stand), once it shows.
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const button = [...document.querySelectorAll<HTMLElement>('button, [role=button], .btn, div, span')].find(
            (node) => node.textContent?.trim() === 'Upload' && node.offsetParent !== null && node.closest('.modal, [class*=modal]') !== null && ![...node.children].some((child) => child.textContent?.trim() === 'Upload' && child.tagName !== 'XD-LOCALIZATION-STRING'),
          );
          (button?.closest('button') ?? button)?.click();
          return button !== undefined;
        }),
      { timeout: 10_000, timeoutMsg: 'no «Upload» in the upload window' },
    );
  }
  await browser.waitUntil(
    () =>
      browser.execute((where: string) => {
        const image = document.querySelector(where === 'chatspace' ? '[data-stand-media] img' : '.message-attachments app-media-template img') as HTMLImageElement | null;
        return image !== null && image.complete && image.naturalWidth > 0;
      }, site),
    { timeout: 15_000, timeoutMsg: 'the photo never showed in the composer' },
  );
}

/**
 * On fansly.com: a photo and a video of the test model's vault, the chatter's usual way (the image icon, «From Vault»,
 * «All», each tile's circle, «Add 2 Media», «Upload»). Nothing is uploaded and nothing is sent.
 */
async function attachFromVault(s: See): Promise<void> {
  await s.web.icon('fa-image');
  await s.web.click('From Vault');
  await s.web.click('All');
  await browser.pause(2500);
  for (const kind of ['photo', 'video'] as const) {
    const at = await browser.execute((want: string) => {
      const tile = [...document.querySelectorAll('.vault-content .render-container')].find((row) => (row.querySelector('app-video-element') !== null) === (want === 'video') && row.querySelector('img') !== null);
      const circle = tile?.querySelector('.image-controls-item')?.getBoundingClientRect();
      return circle === undefined ? null : { x: Math.round(circle.right - 20), y: Math.round(circle.top + 20) };
    }, kind);
    if (at === null) throw new Error(`no ${kind} in the vault`);
    await browser.action('pointer').move({ x: at.x, y: at.y }).down().up().perform();
    await browser.pause(400);
  }
  await s.web.click('Add 2 Media');
  await browser.pause(1500);
  await s.web.click('Upload');
  await browser.waitUntil(() => browser.execute(() => document.querySelectorAll('.message-attachments app-account-media-template').length >= 2), { timeout: 15_000, timeoutMsg: 'the media never showed in the composer' });
}

scenario(
  'draft-media',
  async (s) => {
    await s.ready();
    await s.hub.command({ op: 'config', patch: { aiTexts: { 'fast-reply': 'took this one for you tonight 🌅 the sky went all pink right before the sun touched the water… wish you were on that beach with me' } } });
    if (LIVE) await attachFromVault(s);
    else await attachPhoto(s.site);
    await s.shot('attached');
    await s.press(/^Reply/);
    await s.done();
    await s.shot('reply');
    // The chatters' picture: Reply's answer above the composer that holds the photo.
    const dock = await s.rect('page', '[data-host="dock"]');
    const composer = await s.rect('page', s.site === 'chatspace' ? '[data-stand-composer]' : 'app-messages-conversation-route app-group-message-input');
    if (dock !== null && composer !== null) await s.shot('draft-media', { file: `draft-media-${s.site}`, clip: around([dock, composer], 12) });
  },
  { sites: ['chatspace', 'fansly'] },
);
