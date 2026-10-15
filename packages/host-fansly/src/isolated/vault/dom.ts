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
//     div.vault-wrapper … div.vault-row … div.image-filename         a card: its file name (main:12393, :12438)
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
  card: '.vault-row .image-filename',
} as const;

/** Fansly's own failure words on an upload it gave up (the old extension's, live-seen); nothing landed then. */
const FAILURE = /\b(?:failed|error|retry)\b/i;
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
  /** The album's cards, in the page's order (the newest upload first), as keys. */
  readonly cards: readonly string[];
}

const text = (element: Element | null): string => element?.textContent?.trim() ?? '';

export function readVaultPage(doc: Document): VaultPage {
  const host = doc.querySelector(VAULT_SELECTORS.host);
  if (host === null) return { host, albumOpen: false, title: null, input: null, busy: false, failed: false, cards: [] };
  const uploader = host.querySelector(VAULT_SELECTORS.uploader);
  const title = text(host.querySelector(VAULT_SELECTORS.title));
  return {
    host,
    albumOpen: host.querySelector(VAULT_SELECTORS.header) !== null,
    title: title === '' ? null : title,
    input: uploader === null ? null : uploader.querySelector<HTMLInputElement>(VAULT_SELECTORS.input),
    busy: uploader !== null && uploader.querySelector(VAULT_SELECTORS.busy) !== null,
    failed: uploader !== null && FAILURE.test(text(uploader)),
    cards: [...host.querySelectorAll(VAULT_SELECTORS.card)].map((card) => vaultMediaKey(text(card))).filter((key) => key !== ''),
  };
}
