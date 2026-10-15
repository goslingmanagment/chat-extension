// `/creator/vault` (R20 P13a): `app-media-vault-route > app-media-vault` as the bundle draws it (main:84974,
// :12852-12866) — the list of albums, an open album with its header, «Upload to Vault» with the page's own upload
// input, and the album's cards — with the page's lifecycle around an upload, which the uploader of the vault reads:
// - opening an album loads its media: `GET /media/vaultnew?albumId=<id>&…` (`loadVault`, main:12696-12712);
// - a file on the input's `change` is taken in the same task — the «Processing Media» line (main:11752); a type the
//   page does not accept is ignored (`processFiles`, main:11898-11915) — then processed a moment later into an upload
//   template (`app-account-media-create-template`, main:11758) that uploads it;
// - each uploaded medium is queued and, 1 s after the last one (`onMediaUploaded`, main:12828-12834), added to the
//   open album by one `POST /vault/albums/media {albumId, mediaIds}`; after its success the album is loaded again
//   (`addMediaIdsToAlbum`, main:12818-12827) and its cards show the file names, the newest first (main:12393).
// The upload itself is the stand's stand-in for the site's (`POST /account/media` of the fake Fansly; the site
// uploads to signed addresses of its media gateway). Over the fake Fansly only: without it the route is a
// placeholder.

import type { UploadFile } from './backend';
import { handler } from './events';
import { record } from './journal';
import { el, host, scope, type Scope } from './ng';
import type { WireVaultAlbum, WireVaultAlbumMediaPage } from './wire';

/** The vault's requests, over the page's HTTP client (xhr-backend.ts). */
export interface VaultApi {
  /** `GET /vault/albumsnew`. */
  vaultAlbums(done: (albums: readonly WireVaultAlbum[]) => void): void;
  /** `GET /media/vaultnew?albumId=…`; null — it failed. */
  vaultAlbumMedia(albumId: string, done: (page: WireVaultAlbumMediaPage | null) => void): void;
  /** The stand's upload of one file: its medium's id; null — it failed. */
  vaultUpload(file: UploadFile, done: (mediaId: string | null) => void): void;
  /** `POST /vault/albums/media`. */
  vaultAdd(albumId: string, mediaIds: readonly string[], done: (ok: boolean) => void): void;
}

/** The page's input takes these (its `accept`, main:11937); `processFiles` keeps image, video and audio. */
const ACCEPT = 'image/png, image/jpeg, image/webp, image/gif, video/*, audio/mp4, audio/m4a, audio/x-m4a, audio/mp3, audio/*';
const ADD_DEBOUNCE_MS = 1000;
const PROCESS_MS = 1;

export class VaultRoute {
  readonly host: HTMLElement;
  private readonly s: Scope = scope();
  private readonly view: HTMLElement;
  private albums: readonly WireVaultAlbum[] = [];
  private selected: WireVaultAlbum | null = null;
  private header: HTMLElement | null = null;
  private toggle: HTMLElement | null = null;
  private uploader: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private processing = 0;
  private uploading = 0;
  private queued: string[] = [];
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(private readonly api: VaultApi) {
    this.host = host(scope(), 'app-media-vault-route');
    this.view = host(this.s, 'app-media-vault');
    this.host.append(this.view);
    api.vaultAlbums((albums) => {
      this.albums = albums;
      if (this.selected === null) this.showList();
    });
    this.showList();
  }

  /** The open album's id, or null (the list). */
  get albumId(): string | null {
    return this.selected?.id ?? null;
  }

  /** Opens the album as a click on its tile does. */
  select(albumId: string): void {
    const album = this.albums.find((item) => item.id === albumId);
    if (album === undefined || this.selected?.id === albumId) return;
    this.selected = album;
    this.view.replaceChildren();
    const s = this.s;
    const back = el(s, 'div', { class: 'bubble', attrs: { 'data-menu-item': 'vault-album-back' } }, [el(s, 'i', { class: 'fal fa-arrow-left' })]);
    back.addEventListener('click', handler(() => this.back()));
    this.header = el(s, 'div', { class: 'flex-row vault-header' }, [el(s, 'div', { class: 'flex-row flex-align-center margin-top-1' }, [back, el(s, 'div', { class: 'font-size-xl semi-bold flex-row' }, [` ${album.title} `])]), el(s, 'div', { class: 'flex-1' })]);
    this.body = el(s, 'div', { class: 'vault-wrapper margin-top-2' });
    this.view.append(this.header);
    this.showToggle();
    this.view.append(this.body);
    record('vault-album', { albumId });
    this.load();
  }

  /** Back to the list of albums (`onBackClick`): no request. */
  back(): void {
    this.selected = null;
    this.showList();
  }

  /** «Upload to Vault»: the page's upload input in the open album. */
  expand(): void {
    if (this.selected === null || this.uploader !== null) return;
    const s = this.s;
    const input = el(s, 'input', { attrs: { type: 'file', multiple: '', accept: ACCEPT }, style: 'display: none' });
    input.addEventListener('change', handler(() => this.take(input)));
    const media = el(s, 'div', { class: 'media-wrapper' }, [el(s, 'div', { class: 'media-container-wrapper' }, [el(s, 'div', { class: 'media-container add-more' }, [el(s, 'div', { class: 'dropdown-title' }, [el(s, 'i', { class: 'fa-fw fal fa-plus' })])])])]);
    const collapse = el(s, 'div', { class: 'close-toggle blue-1-hover-only' }, [el(s, 'i', { class: 'fa-fw fal fa-chevrons-up' })]);
    collapse.addEventListener('click', handler(() => this.collapse()));
    this.uploader = host(s, 'app-media-upload-input', { class: 'margin-top-1 margin-bottom-1' });
    this.uploader.append(el(s, 'div', { class: 'media-wrapper-container' }, [media]), input);
    this.toggle?.replaceWith(this.uploader, collapse);
    this.toggle = collapse;
  }

  collapse(): void {
    this.uploader?.remove();
    this.uploader = null;
    this.showToggle();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.debounce !== null) clearTimeout(this.debounce);
  }

  private showList(): void {
    this.header = null;
    this.uploader = null;
    this.toggle = null;
    this.body = null;
    const s = this.s;
    const tiles = this.albums.map((album) => {
      const tile = el(s, 'div', { class: 'vault-album' }, [el(s, 'div', { class: 'vault-album-media' }), el(s, 'div', { class: 'vault-album-footer' }, [el(s, 'div', { class: 'semi-bold' }, [` ${album.title} `])])]);
      tile.addEventListener('click', handler(() => this.select(album.id)));
      return tile;
    });
    this.view.replaceChildren(el(s, 'div', { class: 'vault-albums-container' }, [el(s, 'div', { class: 'font-size-xl semi-bold flex-row' }, ['Albums']), el(s, 'div', { class: 'vault-albums margin-top-1' }, tiles)]));
  }

  private showToggle(): void {
    const s = this.s;
    const toggle = el(s, 'div', { class: 'close-toggle blue-1-hover-only margin-top-1' }, [el(s, 'i', { class: 'fal fa-upload margin-right-text' }), ' Upload to Vault\n']);
    toggle.addEventListener('click', handler(() => this.expand()));
    if (this.toggle !== null) this.toggle.replaceWith(toggle);
    else this.header?.after(toggle);
    this.toggle = toggle;
  }

  /** `loadVault`: the cards go, the album's media are asked, the cards come — the newest first. */
  private load(): void {
    const album = this.selected;
    const body = this.body;
    if (album === null || body === null) return;
    const s = this.s;
    body.replaceChildren(el(s, 'div', { class: 'vault-content' }, [el(s, 'div', { class: 'flex-row flex-center margin-top-4' }, [el(s, 'i', { class: 'fa fa-circle-notch dark-blue-1 fa-2x fa-spin' })])]));
    this.api.vaultAlbumMedia(album.id, (page) => {
      if (this.destroyed || this.selected !== album || page === null) return;
      const names = new Map(page.media.map((media) => [media.id, media.filename]));
      const cards = page.albumMedia.map((item) =>
        el(s, 'div', { class: 'render-container' }, [
          el(s, 'div', { class: 'image-date' }, ['15 Oct']),
          el(s, 'div', { class: 'image-filename blue-1-hover-only pointer' }, [el(s, 'i', { class: 'fa-light fa-pencil' }), ` ${item.customFilename ?? names.get(item.mediaId) ?? ''} `]),
        ]),
      );
      body.replaceChildren(el(s, 'div', { class: 'vault-content' }, [el(s, 'div', { class: 'spacer' }), el(s, 'div', { class: 'vault-row' }, cards), el(s, 'div', { class: 'spacer' })]));
      record('vault-loaded', { albumId: album.id, cards: cards.length });
    });
  }

  /** `onFileInputChange` → `processFiles`: what the page accepts is taken now, processed a moment later, then uploaded. */
  private take(input: HTMLInputElement): void {
    const files = [...(input.files ?? [])].filter((file) => /^(?:image|video|audio)\//.test(file.type));
    input.value = '';
    record('vault-change', { files: files.length });
    if (files.length === 0) return;
    this.processing += files.length;
    this.renderProgress();
    files.forEach((file, index) =>
      setTimeout(
        () => {
          if (this.destroyed) return;
          this.processing -= 1;
          this.uploading += 1;
          this.renderProgress();
          this.api.vaultUpload({ name: file.name, type: file.type, size: file.size }, (mediaId) => {
            this.uploading -= 1;
            this.renderProgress();
            if (mediaId !== null) this.uploaded(mediaId);
          });
        },
        PROCESS_MS * (index + 1),
      ),
    );
  }

  /** «Processing Media (n/m)» and one upload template per file uploading. */
  private renderProgress(): void {
    const uploader = this.uploader;
    if (uploader === null) return;
    const s = this.s;
    uploader.querySelector(':scope .proccessing-templates')?.remove();
    for (const template of uploader.querySelectorAll('.media-container-wrapper:has(> app-account-media-create-template)')) template.remove();
    const media = uploader.querySelector('.media-wrapper');
    if (this.processing > 0) media?.before(el(s, 'div', { class: 'proccessing-templates bold' }, [el(s, 'i', { class: 'fa-fw fal fa-circle-notch fa-spin' }), 'Processing Media', ` (0/${String(this.processing)}) `]));
    for (let i = 0; i < this.uploading; i += 1) media?.prepend(el(s, 'div', { class: 'media-container-wrapper' }, [host(s, 'app-account-media-create-template')]));
  }

  /** `onMediaUploaded`: queued, and added to the open album 1 s after the last one. */
  private uploaded(mediaId: string): void {
    this.queued.push(mediaId);
    if (this.debounce !== null) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      const album = this.selected;
      const ids = this.queued;
      this.queued = [];
      if (album === null || this.destroyed) return;
      this.api.vaultAdd(album.id, ids, (ok) => {
        // The album is loaded again only when it is still the open one.
        if (ok && this.selected?.id === album.id) this.load();
      });
    }, ADD_DEBOUNCE_MS);
  }
}
