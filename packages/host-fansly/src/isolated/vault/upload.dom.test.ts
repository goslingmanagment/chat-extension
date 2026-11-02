import type { HostEvent } from '@cg/contracts/host';
import { afterEach, describe, expect, it } from 'vitest';

import type { FanslyVaultFact } from '../host-port';
import { VAULT_CONFIRM_TIMEOUT_MS } from './rename';
import { createVaultRun } from './run';
import { createVaultUploader, type VaultPort, type VaultTimer, type VaultUploadOutcome } from './upload';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
  history.replaceState({}, '', '/');
});

function clock(): VaultTimer & { fire(ms: number): void } {
  const callbacks = new Map<object, { callback: () => void; ms: number }>();
  return {
    set(callback, ms) {
      const id = {};
      callbacks.set(id, { callback, ms });
      return id;
    },
    clear(id) { callbacks.delete(id as object); },
    fire(ms) {
      for (const [id, entry] of [...callbacks]) if (entry.ms === ms) {
        callbacks.delete(id);
        entry.callback();
      }
    },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function world(before: string[] = []) {
  history.replaceState({}, '', '/creator/vault');
  document.body.innerHTML = '<app-media-vault-route><app-media-vault><div class="vault-header"><div class="font-size-xl">Test pack</div></div><app-media-upload-input><input type="file"></app-media-upload-input><div class="vault-wrapper"><div class="vault-content"><div class="vault-row"></div></div></div></app-media-vault></app-media-vault-route>';
  const host = document.querySelector('app-media-vault') as HTMLElement;
  const input = host.querySelector('input') as HTMLInputElement;
  const facts = new Set<(fact: FanslyVaultFact) => void>();
  const events = new Set<(event: HostEvent) => void>();
  let account = '100';
  let seq = 1;
  let changes = 0;
  let saves = 0;
  let acceptSave = true;
  let deferModal = false;
  let pendingModal: (() => void) | null = null;
  let onInput: (() => void) | null = null;
  const timer = clock();
  const port: VaultPort = {
    current: () => ({ accounts: [{ hostAccountId: account }], route: { epoch: 1 } }) as unknown as ReturnType<VaultPort['current']>,
    subscribe(callback) { events.add(callback); return () => events.delete(callback); },
    vault: {
      album: () => ({ albumId: '200', seq }),
      onFact(callback) { facts.add(callback); return () => facts.delete(callback); },
      onLost: () => () => undefined,
    },
  };
  const render = (names: string[], processing = false): void => {
    const list = document.createElement('div');
    list.className = 'vault-content';
    const row = document.createElement('div');
    row.className = 'vault-row';
    list.append(row);
    names.forEach((name, index) => {
      const card = document.createElement('div');
      card.className = 'render-container';
      const label = document.createElement('div');
      label.className = 'image-filename';
      const nameText = document.createTextNode(name);
      label.append(nameText);
      label.onclick = () => {
        const open = (): void => {
          const modal = document.createElement('app-vault-ablum-media-rename-modal');
          modal.innerHTML = '<div class="modal"><input type="text"><div class="btn solid-blue">Save</div></div>';
          const field = modal.querySelector('input') as HTMLInputElement;
          field.addEventListener('input', () => onInput?.());
          (modal.querySelector('.btn') as HTMLElement).onclick = () => {
            saves += 1;
            if (!acceptSave) return;
            // Angular updates an existing text node; no childList mutation in the album.
            nameText.data = field.value;
            modal.remove();
          };
          document.body.append(modal);
        };
        if (deferModal) pendingModal = open;
        else open();
      };
      card.append(label);
      if (index === 0 && processing) card.append(Object.assign(document.createElement('span'), { className: 'processing', textContent: 'Video Processing' }));
      row.append(card);
    });
    host.querySelector('.vault-content')?.replaceWith(list);
  };
  render(before);
  input.addEventListener('change', () => {
    changes += 1;
    const busy = document.createElement('div');
    busy.className = 'proccessing-templates';
    input.parentElement?.append(busy);
  });
  const uploader = createVaultUploader({ win: window, port, timer });
  cleanups.push(() => uploader.dispose());
  const emit = (fact: FanslyVaultFact): void => { for (const callback of facts) callback(fact); };
  return {
    uploader, timer, input,
    target: { hostAccountId: '100', albumId: '200', title: 'Test pack' },
    get changes() { return changes; },
    get saves() { return saves; },
    complete(names: string[], processing = false) {
      emit({ t: 'fx.vaultAdded', p: { seq: ++seq } });
      input.parentElement?.querySelector('.proccessing-templates')?.remove();
      render(names, processing);
      emit({ t: 'fx.vaultLoaded', p: { albumId: '200', seq: ++seq } });
    },
    deferRename() { deferModal = true; },
    refuseRename() { acceptSave = false; },
    openRename() { pendingModal?.(); },
    changeAccount() {
      account = '101';
      for (const callback of events) callback({ type: 'accounts' } as HostEvent);
    },
    duringRenameInput(callback: () => void) { onInput = callback; },
  };
}

const file = (name = 'PACK_02.jpg'): File => new File(['synthetic fixture'], name, { type: 'image/jpeg' });

describe('vault upload confirmation when Fansly keeps an old filename', () => {
  it('renames only the single new album card, confirms it and continues the run without a second handoff', async () => {
    const w = world(['older.jpeg']);
    const checkpoints: number[] = [];
    const run = createVaultRun({ target: w.target, files: [file(), file('PACK_01.jpg')], checkpoint: null }, {
      uploader: w.uploader,
      store: { load: async () => null, save: async (checkpoint) => { checkpoints.push(checkpoint.confirmed); return true; }, clear: async () => true },
    });
    const finished = run.start();
    await flush();
    w.complete(['IMG_0001.jpeg', 'older.jpeg']);
    await flush();
    expect(w.saves).toBe(1);
    expect(w.changes).toBe(2);
    expect(w.uploader.view().names).toEqual(['PACK_02.jpg', 'older.jpeg']);
    w.complete(['PACK_01.jpeg', 'PACK_02.jpg', 'older.jpeg']);
    await finished;
    expect(run.snapshot()).toMatchObject({ state: 'complete', confirmed: 2 });
    expect(w.changes).toBe(2);
    expect(w.saves).toBe(1);
    expect(checkpoints).toContain(1);
    expect(w.uploader.stats().watching).toBe(false);
  });

  it('waits for video processing and notices characterData changes without a childList mutation', async () => {
    const w = world();
    let result: VaultUploadOutcome | undefined;
    void w.uploader.upload(file('PACK_02.mov'), w.target).then((outcome) => { result = outcome; });
    w.complete(['PACK_02.mp4'], true);
    await flush();
    expect(result).toBeUndefined();
    const text = document.querySelector('.processing')?.firstChild as Text;
    text.data = '';
    await flush();
    expect(result).toMatchObject({ state: 'done', top: 'pack_02' });
    expect(w.saves).toBe(0);
  });

  it('does not rename ambiguous concurrent additions and stops promptly without handing the file over again', async () => {
    const w = world(['older.jpeg']);
    let result: VaultUploadOutcome | undefined;
    void w.uploader.upload(file(), w.target).then((outcome) => { result = outcome; });
    w.complete(['unknown-a.jpeg', 'unknown-b.jpeg', 'older.jpeg']);
    await flush();
    expect(w.saves).toBe(0);
    expect(result).toBeUndefined();
    w.timer.fire(VAULT_CONFIRM_TIMEOUT_MS);
    await flush();
    expect(result).toMatchObject({ state: 'unknown', halt: 'confirmation-failed' });
    expect(w.changes).toBe(1);
  });

  it('does not touch a delayed rename dialog after the account changes', async () => {
    const w = world();
    w.deferRename();
    const result = w.uploader.upload(file(), w.target);
    w.complete(['IMG_0001.jpeg']);
    await flush();
    w.changeAccount();
    w.openRename();
    await flush();
    expect(await result).toMatchObject({ state: 'unknown', halt: 'account-changed' });
    expect(w.saves).toBe(0);
    expect(document.querySelector('input[type=text]')?.getAttribute('value')).toBeNull();
  });

  it('bounds an unconfirmed Save without repeating Save or the upload', async () => {
    const w = world();
    w.refuseRename();
    const result = w.uploader.upload(file(), w.target);
    w.complete(['IMG_0001.jpeg']);
    await flush();
    expect(w.saves).toBe(1);
    w.timer.fire(VAULT_CONFIRM_TIMEOUT_MS);
    await flush();
    expect(await result).toMatchObject({ state: 'unknown', halt: 'confirmation-failed' });
    expect(w.saves).toBe(1);
    expect(w.changes).toBe(1);
    expect(w.uploader.stats().watching).toBe(false);
  });

  it('rechecks the account between filling the name and Save', async () => {
    const w = world();
    w.duringRenameInput(() => w.changeAccount());
    const result = w.uploader.upload(file(), w.target);
    w.complete(['IMG_0001.jpeg']);
    await flush();
    expect(await result).toMatchObject({ state: 'unknown', halt: 'account-changed' });
    expect(w.saves).toBe(0);
  });
});
