// The media of the message being written on fansly.com, as its composer shows it (`HostPort.readDraftMedia`): Fansly
// puts each «Upload» (from the vault or a file) into the main composer's `div.message-attachments` as one
// `app-account-media-create-template.attachment`, and every medium of it as an `app-account-media-template` whose
// `app-media-template` shows the medium — a photo as its own `<img>` (a blob the page made from its CDN), a video as
// its player with the cover in `app-media.preview` and its length in `.play-time` («0:00 / 0:45»), an audio as a plain
// `<audio>` (its length once the page has its metadata). Seen live on the test model, 2026-10-27. The pictures are the
// page's own images, drawn as they are: no request of ours. The price stays inside Fansly's permissions dialog, never in
// the composer: it is not read.

import { type ComposerMedium } from '@cg/host-kit/isolated/photos';

const MEDIUM = 'app-account-media-create-template app-account-media-template';
const SHOWN = 'app-media-template';
const VIDEO = 'app-video-element';
const COVER = 'app-media.preview img.cover, app-media.preview img';
const PLAY_TIME = '.play-time';

/** «0:00 / 1:02:03» → the total in seconds; undefined — not shown. */
export function playTimeSeconds(text: string | null | undefined): number | undefined {
  const total = (text ?? '').split('/').pop()?.trim() ?? '';
  if (!/^\d{1,3}(:\d{2}){1,2}$/.test(total)) return undefined;
  return total.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
}

/** The image a medium shows: a photo's own, a video's cover. */
function pictureOf(shown: Element, video: boolean): HTMLImageElement | null {
  const image = video ? shown.querySelector(COVER) : (shown.querySelector(':scope > img') ?? shown.querySelector('img'));
  return image !== null && image.tagName === 'IMG' ? (image as HTMLImageElement) : null;
}

/**
 * The media of the main composer's attachments, in the order the composer shows them. `draw` makes a JPEG of an image
 * the page already shows (host-kit `shownImageAsJpeg`). Empty — nothing attached.
 */
export function readComposerMedia(attachments: Element, draw: (image: HTMLImageElement) => Promise<string | null>): ComposerMedium[] {
  const media: ComposerMedium[] = [];
  for (const medium of Array.from(attachments.querySelectorAll(MEDIUM))) {
    const shown = medium.querySelector(SHOWN) ?? medium;
    const video = shown.querySelector(VIDEO) !== null;
    const player = video ? null : shown.querySelector('audio');
    const audio = player !== null;
    const image = audio ? null : pictureOf(shown, video);
    if (!video && !audio && image === null) continue;
    const durationSec = video ? playTimeSeconds(shown.querySelector(PLAY_TIME)?.textContent) : player !== null && Number.isFinite(player.duration) ? player.duration : undefined;
    media.push({
      type: video ? 'video' : audio ? 'audio' : 'photo',
      ...(durationSec === undefined ? {} : { durationSec }),
      draw: image === null ? null : () => draw(image),
    });
  }
  return media;
}
