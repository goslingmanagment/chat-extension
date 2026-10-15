// A Fansly-like vault page for the uploader's DOM tests (test-only; nothing that ships imports it): the album view of
// `/creator/vault` as isolated/vault/dom.ts draws it from the bundle — the route's `app-media-vault`, the open album's
// header and title, «Upload to Vault» with the page's own file input, its processing line and upload template, the
// album's cards — and the page's reaction to a file: on `change` it takes the files it accepts and shows its
// processing line in the same task (main:11752, :11941); the test says when the upload ends, fails, or what the
// album shows after a reload. The same view inside the chat's «From Vault» modal is `modal()`. The Firefox stand is
// packages/testing/fixture-fansly (its vault route); this is only the shape of it.

import type { HostEvent, HostSnapshot } from '@cg/contracts/host';
import type { HostAccount } from '@cg/contracts/ids';

import type { FanslyVaultFact } from '../isolated/host-port';
import type { VaultPort } from '../isolated/vault/upload';

export interface FakeVaultPage {
  readonly host: HTMLElement;
  /** Files the page took from its input, in order. */
  readonly taken: File[];
  /** `change` events the page's input got. */
  readonly changes: number;
  /** The page ignores the files it is handed (a type it does not accept). */
  ignore: boolean;
  /**
   * An album opens: its header and title, and the page's spinner while its media load (`loadingVault`, main:12370,
   * :12703); its cards come with `cards()`.
   */
  openAlbum(title: string): void;
  /** The album is loaded again (`loadVault`): its list gives way to the spinner until `cards()`. */
  loading(): void;
  /** Back to the list of albums: no header, no uploader, no cards. */
  closeAlbum(): void;
  /** «Upload to Vault» expanded: the page's upload input and its file input. */
  expandUploader(): void;
  collapseUploader(): void;
  /** The processing file finished uploading: its template goes. */
  uploaded(): void;
  /** The upload failed: Fansly's failure words in the uploader. */
  failUpload(): void;
  /**
   * A load of the album answered: a NEW list (`*ngIf="!loadingVault"`, main:12443) with its cards, the newest first;
   * a name in `processing` shows Fansly's «Processing» on its card.
   */
  cards(names: readonly string[], processing?: readonly string[]): void;
  /** The «From Vault» modal of a chat: the same album view outside the route. */
  modal(): HTMLElement;
  destroy(): void;
}

const make = (tag: string, className?: string, children: ReadonlyArray<Node | string> = []): HTMLElement => {
  const element = document.createElement(tag);
  if (className !== undefined) element.className = className;
  element.append(...children);
  return element;
};

export function createFakeVaultPage(): FakeVaultPage {
  const host = make('app-media-vault');
  const route = make('app-media-vault-route', undefined, [host]);
  document.body.append(make('div', 'content-wrapper', [make('router-outlet'), route]));
  let header: HTMLElement | null = null;
  let uploader: HTMLElement | null = null;
  let wrapper: HTMLElement | null = null;
  let changes = 0;
  const taken: File[] = [];
  const list = (): HTMLElement => {
    wrapper ??= make('div', 'vault-wrapper margin-top-2');
    if (!wrapper.isConnected) host.append(wrapper);
    return wrapper;
  };
  const media = (): HTMLElement | null => uploader?.querySelector('.media-wrapper') ?? null;

  const page: FakeVaultPage = {
    host,
    taken,
    get changes() {
      return changes;
    },
    ignore: false,
    openAlbum(title) {
      page.closeAlbum();
      header = make('div', 'flex-row vault-header', [
        make('div', 'flex-row flex-align-center margin-top-1', [make('div', 'bubble', [make('i', 'fal fa-arrow-left')]), make('div', 'font-size-xl semi-bold flex-row', [` ${title} `])]),
        make('div', 'flex-1'),
      ]);
      host.prepend(header);
      page.loading();
    },
    loading() {
      list().replaceChildren(make('div', 'vault-content', [make('div', 'flex-row flex-center margin-top-4', [make('i', 'fa fa-circle-notch dark-blue-1 fa-2x fa-spin')])]));
    },
    closeAlbum() {
      header?.remove();
      header = null;
      page.collapseUploader();
      wrapper?.remove();
      wrapper = null;
    },
    expandUploader() {
      if (uploader !== null) return;
      const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true });
      input.addEventListener('change', () => {
        changes += 1;
        const files = [...(input.files ?? [])];
        if (page.ignore || files.length === 0) return;
        taken.push(...files);
        // Its processing line, then its upload template — in the same task, as the page's refreshUi.
        media()?.prepend(make('div', 'media-container-wrapper', [make('app-account-media-create-template')]));
        uploader?.prepend(make('div', 'proccessing-templates bold', [make('i', 'fa-fw fal fa-circle-notch fa-spin'), 'Processing Media', ' (0/1) ']));
        input.value = '';
      });
      uploader = make('app-media-upload-input', 'margin-top-1 margin-bottom-1', [
        make('div', 'media-wrapper-container', [make('div', 'media-wrapper', [make('div', 'media-container-wrapper', [make('div', 'media-container add-more')])])]),
        input,
      ]);
      header?.after(uploader);
    },
    collapseUploader() {
      uploader?.remove();
      uploader = null;
    },
    uploaded() {
      uploader?.querySelector('.proccessing-templates')?.remove();
      uploader?.querySelector('app-account-media-create-template')?.parentElement?.remove();
    },
    failUpload() {
      uploader?.querySelector('.proccessing-templates')?.remove();
      uploader?.querySelector('app-account-media-create-template')?.append(' Upload failed, Retry ');
    },
    cards(names, processing = []) {
      const rows = list();
      const card = (name: string): HTMLElement =>
        make('div', 'render-container', [
          make('div', 'image-date', ['15 Oct']),
          make('div', 'image-filename blue-1-hover-only pointer', [make('i', 'fa-light fa-pencil'), ` ${name} `]),
          ...(processing.includes(name) ? [make('div', 'processing-overlay', ['Processing'])] : []),
        ]);
      rows.replaceChildren(make('div', 'vault-content', [make('div', 'spacer'), make('div', 'vault-row', names.map(card)), make('div', 'spacer')]));
    },
    modal() {
      const view = make('app-media-vault', undefined, [make('div', 'flex-row vault-header', [make('div', 'font-size-xl semi-bold flex-row', ['Modal album'])])]);
      document.body.append(make('div', 'modal-wrapper', [view]));
      return view;
    },
    destroy() {
      route.parentElement?.remove();
      for (const modal of document.querySelectorAll('.modal-wrapper')) modal.remove();
    },
  };
  return page;
}

// ── The port's side: the vault's facts from MAIN, the account, the route ──


export interface FakeVaultPort {
  readonly port: VaultPort;
  /** MAIN saw the page add media to an album (`fx.vaultAdded`). */
  added(seq: number): void;
  /** MAIN saw the page load an album (`fx.vaultLoaded`). */
  loaded(albumId: string | null, seq: number): void;
  /** The page's creator as its `/account/me` said it; null — not yet. */
  creator(id: string | null): void;
  /** The address changed (the port says a route under a new epoch). */
  navigate(path: string): void;
  /** MAIN's stream lost facts (`fx.gap`, a refused batch). */
  lose(): void;
  /** Listeners on the facts and the port's events now: what the uploader watches. */
  listeners(): number;
}

const accountOf = (id: string): HostAccount => ({ host: 'fansly-web', hostAccountId: id, platform: 'fansly', platformAccountId: id, username: null, displayName: null });

export function createFakeVaultPort(creatorId: string | null): FakeVaultPort {
  const facts = new Set<(fact: FanslyVaultFact) => void>();
  const losses = new Set<() => void>();
  const events = new Set<(event: HostEvent) => void>();
  let album: { readonly albumId: string | null; readonly seq: number } | null = null;
  let accounts: readonly HostAccount[] = creatorId === null ? [] : [accountOf(creatorId)];
  let epoch = 1;
  const fact = (value: FanslyVaultFact): void => {
    if (value.t === 'fx.vaultLoaded' && (album === null || value.p.seq > album.seq)) album = value.p;
    for (const listener of [...facts]) listener(value);
  };
  const emit = (event: HostEvent): void => {
    for (const listener of [...events]) listener(event);
  };
  return {
    port: {
      vault: {
        album: () => album,
        onFact(cb) {
          facts.add(cb);
          return () => {
            facts.delete(cb);
          };
        },
        onLost(cb) {
          losses.add(cb);
          return () => {
            losses.delete(cb);
          };
        },
      },
      current: () => ({ accounts, route: { epoch, name: 'other', account: accounts[0] ?? null, chat: null } }) as HostSnapshot,
      subscribe(cb) {
        events.add(cb);
        return () => {
          events.delete(cb);
        };
      },
    },
    added: (seq) => fact({ t: 'fx.vaultAdded', p: { seq } }),
    loaded: (albumId, seq) => fact({ t: 'fx.vaultLoaded', p: { albumId, seq } }),
    creator(id) {
      // Another creator is another generation of the port: its route moves first, then its accounts (host-port.ts).
      accounts = id === null ? [] : [accountOf(id)];
      epoch += 1;
      emit({ type: 'route', route: { epoch, name: 'other', account: accounts[0] ?? null, chat: null } });
      emit({ type: 'accounts', accounts });
    },
    navigate(path) {
      history.pushState({}, '', path);
      album = null;
      epoch += 1;
      emit({ type: 'route', route: { epoch, name: 'other', account: accounts[0] ?? null, chat: null } });
    },
    lose() {
      album = null;
      for (const listener of [...losses]) listener();
    },
    listeners: () => facts.size + losses.size + events.size,
  };
}
