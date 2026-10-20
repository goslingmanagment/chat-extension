// The vault page of Fansly as the uploader reads it (docs/project-unite/architecture.md §7.11; R20 P13a). Every
// selector the uploader depends on is here, next to where the bundle draws it (`main:N` — a line of the formatted
// bundle 2026-10-12, `pretty/main.2e6b96097a4bb73b.js`), so a redesign is a one-file fix. The old extension's
// adapter (fansly-chat `src/content/vault/vault-dom.ts`, seen live 2026-09-09) read the same nodes.
//
//   app-media-vault-route > app-media-vault                         the route's album view (main:84974)
//     div.flex-row.vault-header                                     only while an album is open (main:12179)
//       … div.font-size-xl.semi-bold.flex-row                       the album's title (main:12226)
//     app-media-upload-input                                        «Upload to Vault» expanded (main:12359)
//       … div.proccessing-templates                                 files being processed (main:11752)
//       … app-account-media-create-template                         a file uploading (main:11758)
//       input[type=file]                                            the page's own input, one `change` (main:11941)
//     div.vault-wrapper > div.vault-content                          the album's media, made anew by every load that
//                                                                    answers (`*ngIf="!loadingVault"`, main:12443);
//       … div.flex-row.flex-center                                  its spinner instead while a load is on the way
//                                                                    (`*ngIf="loadingVault"`, main:12370, :12703)
//       … div.render-container                                      a card: its date, its file name
//         … div.image-filename                                      (main:12393, :12438); «Processing» on a medium
//                                                                    Fansly is still making ready (the old extension)
//
// The same `app-media-vault` stands in the chat's «From Vault» modal: only the route's one counts. The album's id is
// not on the page at all — MAIN names it from the address the page loads the album with (`fx.vaultLoaded`).
// Reading is synchronous and observes nothing; the album is watched only while a file is in flight (FS-VLT-2), by
// the uploader (upload.ts).

/** Where the vault's anchors are (§7.11, FS-VLT-1). */
export const VAULT_SELECTORS = {
  path: '/creator/vault',
  host: 'app-media-vault-route > app-media-vault',
  header: '.vault-header',
  title: '.vault-header .font-size-xl',
  uploader: 'app-media-upload-input',
  input: 'input[type=file]',
  busy: '.proccessing-templates, app-account-media-create-template',
  list: '.vault-wrapper > .vault-content',
  spinner: ':scope > .flex-center',
  card: '.vault-row .render-container',
  name: '.image-filename',
} as const;

/** Fansly's own failure words on an upload it gave up (the old extension's, live-seen); nothing landed then. */
const FAILURE = /\b(?:failed|error|retry)\b/i;
/** The most of Fansly's failure words the panel quotes. */
const FAILURE_MAX = 200;
/** A card of a medium Fansly is not done with (the old extension's, live-seen): not ready, whatever its name says. */
const UNSETTLED = /verifying|processing|uploading|failed|error|\d+(?:\.\d+)?%/i;
/** The extensions Fansly rewrites on its cards (`IMG_1.JPG` → `IMG_1.jpeg`): a match never takes part of them. */
const MEDIA_EXTENSION = /\.(?:jpe?g|png|gif|webp|mp4|mov|m4v|webm|mp3|m4a)$/i;

/**
 * The key a card is matched by: the file name without its media extension, NFC, trimmed, lower-case (the old
 * extension's rule): Fansly shows the upload's file name with its extension normalized.
 */
export function vaultMediaKey(name: string): string {
  return name.normalize('NFC').trim().replace(MEDIA_EXTENSION, '').trim().toLowerCase();
}

export const isVaultPath = (path: string): boolean => path === VAULT_SELECTORS.path || path === `${VAULT_SELECTORS.path}/`;

/** One synchronous reading of the vault page; nothing kept. */
export interface VaultPage {
  /** The route's album view; null — not the vault page, or not rendered yet. */
  readonly host: Element | null;
  /** An album is open (its header stands). */
  readonly albumOpen: boolean;
  /** The open album's title as the page shows it; null — none. */
  readonly title: string | null;
  /** The page's file input — there only while «Upload to Vault» is expanded in an open album. */
  readonly input: HTMLInputElement | null;
  /** A file of the page's own is being processed or uploaded: never hand over another one. */
  readonly busy: boolean;
  /** The uploader shows Fansly's failure words. */
  readonly failed: boolean;
  /** Those words as the page shows them (its lines that say so, «Upload failed. Retry»); null — none. */
  readonly failure: string | null;
  /**
   * The album's list as the page shows it now — a new element for every load that answered; its spinner while one
   * is on the way (`loading`). null — no list.
   */
  readonly list: Element | null;
  readonly loading: boolean;
  /** The album's cards, in the page's order (the newest upload first), as keys. */
  readonly cards: readonly string[];
  /** The same cards' file names as the page shows them. */
  readonly names: readonly string[];
  /** The cards Fansly is done with: no «Processing», no failure on them. */
  readonly settled: readonly string[];
}

const text = (element: Element | null): string => element?.textContent?.trim() ?? '';

/** The uploader's lines that carry Fansly's failure words, as shown (`innerText` keeps the page's line breaks). */
function failureOf(uploader: Element | null): string | null {
  if (uploader === null) return null;
  const shown = (uploader as HTMLElement).innerText;
  const lines = (typeof shown === 'string' && shown !== '' ? shown : (uploader.textContent ?? '')).split('\n');
  const said = lines.map((line) => line.replace(/\s+/g, ' ').trim()).filter((line) => FAILURE.test(line));
  return said.length === 0 ? null : said.join(' ').slice(0, FAILURE_MAX);
}

export function readVaultPage(doc: Document): VaultPage {
  const host = doc.querySelector(VAULT_SELECTORS.host);
  if (host === null) return { host, albumOpen: false, title: null, input: null, busy: false, failed: false, failure: null, list: null, loading: false, cards: [], names: [], settled: [] };
  const uploader = host.querySelector(VAULT_SELECTORS.uploader);
  const title = text(host.querySelector(VAULT_SELECTORS.title));
  const list = host.querySelector(VAULT_SELECTORS.list);
  const cards: string[] = [];
  const names: string[] = [];
  const settled: string[] = [];
  for (const card of host.querySelectorAll(VAULT_SELECTORS.card)) {
    const name = text(card.querySelector(VAULT_SELECTORS.name));
    const key = vaultMediaKey(name);
    if (key === '') continue;
    cards.push(key);
    names.push(name);
    // The card's own words beside its file name — a name may say «processing» itself.
    if (!UNSETTLED.test(text(card).replace(name, ''))) settled.push(key);
  }
  const failure = failureOf(uploader);
  return {
    host,
    albumOpen: host.querySelector(VAULT_SELECTORS.header) !== null,
    title: title === '' ? null : title,
    input: uploader === null ? null : uploader.querySelector<HTMLInputElement>(VAULT_SELECTORS.input),
    busy: uploader !== null && uploader.querySelector(VAULT_SELECTORS.busy) !== null,
    failed: failure !== null,
    failure,
    list,
    loading: list !== null && list.querySelector(VAULT_SELECTORS.spinner) !== null,
    cards,
    names,
    settled,
  };
}
