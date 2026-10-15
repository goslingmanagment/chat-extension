// Minimal page-owned vault (P13a): one change -> media creation -> 1 s debounce -> add -> reload.
// Synthetic files never leave loopback. The POST response carries no album or media identity.
import { FanslyHttp, type HttpConfig } from './http';
import type { WireVaultAlbums } from './wire';

export function createVaultPage(config: HttpConfig): HTMLElement {
  const page = document.createElement('app-media-vault-route');
  const http = new FanslyHttp(config);
  http.request<WireVaultAlbums>('GET', '/vault/albumsnew', null, (error, albums) => {
    if (error || !albums) return;
    const choose = document.createElement('div');
    const content = document.createElement('div');
    page.append(choose, content);
    for (const album of albums.albums) {
      const button = document.createElement('button'); button.textContent = album.title;
      button.dataset['albumId'] = album.id;
      button.addEventListener('click', () => {
        const vault = document.createElement('app-media-vault');
        const title = document.createElement('h1'); title.textContent = album.title;
        const uploader = document.createElement('app-media-upload-input');
        const input = document.createElement('input'); input.type = 'file'; input.multiple = true;
        const status = document.createElement('span');
        const cards = document.createElement('div'); cards.className = 'vault-cards';
        uploader.append(input, status); vault.append(title, uploader, cards); content.replaceChildren(vault);
        const reload = (): void => {
          http.request<{ media: { id: string; filename: string }[] }>('GET', `/media/vaultnew?albumId=${album.id}&limit=50&offset=0`, null, (failure, result) => {
            if (failure || !result) { status.textContent = 'Error loading album'; return; }
            cards.replaceChildren(...result.media.map((media) => {
              const row = document.createElement('div'); row.className = 'vault-row';
              const name = document.createElement('span'); name.className = 'image-filename'; name.textContent = media.filename;
              row.append(name); return row;
            }));
            status.textContent = '';
          });
        };
        input.addEventListener('change', () => {
          const files = [...(input.files ?? [])];
          status.textContent = 'Uploading';
          http.request<{ contentId: string }[]>('POST', '/account/media', files.map((f) => ({ name: f.name, size: f.size, type: f.type })), (failure, media) => {
            if (failure || !media) { status.textContent = 'Failed'; return; }
            setTimeout(() => {
              http.request<unknown>('POST', '/vault/albums/media', { albumId: album.id, mediaIds: media.map((m) => m.contentId) }, (failed) => {
                if (failed) { status.textContent = 'Failed'; return; }
                reload();
              });
            }, 1000);
          });
        });
        reload();
      });
      choose.append(button);
    }
  });
  return page;
}
