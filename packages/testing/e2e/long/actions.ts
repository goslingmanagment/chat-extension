// Actions on synthetic pages only. TEST-only probes remain for the scheduler and native notes CRUD.
import { writeFileSync } from 'node:fs';

import type { Admission, SiteOpView } from '@cg/contracts';
import { browser, expect } from '@wdio/globals';

import type { FakeHubControlClient } from '../../src/fake-hub/control-client';
import type { Action } from '../../src/long-run/report';
import { WORLD, meta } from '../../src/scenarios/hub';
import { pageRpc, readLocalStorage, waitForReport, writeLocalStorage } from '../support/extension';
import { testBuildPage } from '../support/fake-hub';
import { type FanslyShift } from '../support/fansly-shift';
import { FANSLY_MAIN, callFansly, fakeFansly, openFanslyStand } from '../support/fansly-stand';
import { ours, oursExists, pressOurs, readOurs, waitOursByText } from '../support/ours';
import { dockIs } from '../support/shift';

export interface Chat { readonly group: string; readonly fan: string }

export class LongRunActions {
  private sequence = 0;
  constructor(
    private readonly shift: FanslyShift,
    private readonly hub: FakeHubControlClient,
    private readonly evidenceDir: string,
    private readonly count: (action: Action) => void,
    private readonly leak: () => void,
    private readonly expectSend: () => void,
  ) {}

  async open(chat: Chat): Promise<void> {
    await this.shift.toFansly();
    await callFansly('open', chat.group, 'router');
    await dockIs((dock) => dock.status === 'ready' && dock.target?.endsWith(`:${chat.fan}`) === true && dock.actions['reply'] === true, `Fansly ${chat.group}`, 20_000);
  }

  private async probe<T>(input: Record<string, unknown>): Promise<T> {
    const id = `long-${++this.sequence}`;
    await browser.execute((raw) => document.documentElement.setAttribute('data-cg-ops-command', raw), JSON.stringify({ id, ...input }));
    const report = await waitForReport((now) => {
      const result = now['siteOps'] as { id?: string; error?: string } | undefined;
      if (result?.error !== undefined) throw new Error(result.error);
      return result?.id === id;
    }, `operation probe ${id}`, 20_000);
    const result = report['siteOps'] as { answer: { ok: true; payload: T } | { ok: false; error: { code: string } } };
    if (!result.answer.ok) throw new Error(`operation probe: ${result.answer.error.code}`);
    return result.answer.payload;
  }

  private async finished(opId: string): Promise<SiteOpView> {
    let view: SiteOpView | null = null;
    await browser.waitUntil(async () => {
      view = (await this.probe<{ view: SiteOpView | null }>({ op: 'read', opId })).view;
      return view !== null && ['done', 'failed', 'canceled', 'interrupted'].includes(view.state);
    }, { timeout: 30_000, timeoutMsg: `stuck site operation ${opId}` });
    if (view === null) throw new Error(`missing site operation ${opId}`);
    return view;
  }

  /** Fill/cancel/refill ALL three slots (one free slot is insufficient), then complete fresh operations. */
  async admission(chats: readonly Chat[]): Promise<void> {
    const admitted = async (): Promise<string> => {
      const result = await this.probe<Admission>({ op: 'start', feature: 'notes-fill' });
      if (!result.ok) { this.leak(); throw new Error(`admission refused after release: ${result.code}`); }
      return result.opId;
    };
    for (let round = 0; round < 2; round += 1) {
      const opIds: string[] = [];
      const gates = [0, 1, 2].map((index) => `long-admission-${++this.sequence}-${index}`);
      await this.hub.command({ op: 'scriptSse', feature: 'fan-notes-fill', responses: gates.map((name) => ({ kind: 'stream', steps: [
        { kind: 'frame', frame: meta('fan-notes-fill', { pageLabel: WORLD.pages.fansly.pageLabel }) }, { kind: 'gate', name },
        { kind: 'frame', frame: { type: 'content_delta', text: 'Name: Synthetic\nCity: Synthetic' } },
        { kind: 'frame', frame: { type: 'done', stopReason: 'end_turn' } }, { kind: 'eof' },
      ] })) });
      try {
        for (const chat of chats.slice(0, 3)) { await this.open(chat); opIds.push(await admitted()); }
        const fourth = chats[3];
        if (fourth === undefined || opIds.length !== 3) throw new Error('admission needs four chats');
        await this.open(fourth);
        expect(await this.probe<Admission>({ op: 'start', feature: 'notes-fill' })).toMatchObject({ ok: false, code: 'CG-OP-TAB-LIMIT' });
      } finally {
        for (const opId of opIds) expect(await this.probe({ op: 'cancel', opId })).toEqual({ state: 'canceled' });
        for (const gate of gates) await this.hub.command({ op: 'release', gate });
        await this.hub.command({ op: 'clearScripts' });
      }
    }
    for (const chat of chats.slice(0, 3)) {
      await this.open(chat);
      const view = await this.finished(await admitted());
      expect(view.state).toBe('done');
      expect(view.result?.kind).toBe('note-fields');
    }
    this.count('admission');
  }

  private async openNewcomers(): Promise<void> {
    // Fansly has no palette. Focus it before the popup command, with ChatSpace beside it.
    await this.shift.toFansly();
    await this.shift.toPages();
    await browser.url(testBuildPage('popup.html'));
    try {
      expect(await pageRpc('site.access', { host: 'fansly-web' })).toMatchObject({ ok: true, payload: { enabled: true, granted: true, registered: true } });
      expect(await pageRpc('tab.command', { command: { kind: 'surface', surface: 'newcomers' } })).toMatchObject({ ok: true, payload: { delivered: true } });
    } finally {
      await browser.url(testBuildPage());
      await this.shift.toFansly();
    }
    await browser.waitUntil(() => oursExists('modal', '.cg-fnw'), { timeout: 15_000, timeoutMsg: 'popup did not open Fansly newcomers' });
  }

  private async closeNewcomers(): Promise<void> {
    await browser.keys(['Escape']);
    await browser.waitUntil(async () => !(await oursExists('modal', '.cg-fnw')), { timeout: 5000, timeoutMsg: 'newcomers window stuck' });
  }

  /** The existing pass UI: let the queue check at least one fan, pause/resume and close. */
  async newcomers(): Promise<void> {
    await this.openNewcomers();
    await browser.waitUntil(() => oursExists('modal', '.cg-fnw__row[data-cg-check]:not([data-cg-check="pending"]):not([data-cg-check="checking"])'), { timeout: 60_000, timeoutMsg: 'newcomers checked no fan' });
    await pressOurs('modal', 'button.cg-fnw__run', 'Пауза', 'pause the newcomers queue', 20_000);
    await waitOursByText('modal', 'button.cg-fnw__run', /^Проверить оставшихся/, 'queue paused', 15_000);
    await pressOurs('modal', 'button.cg-fnw__run', /^Проверить оставшихся/);
    await waitOursByText('modal', 'button.cg-fnw__run', 'Пауза', 'queue resumed', 15_000);
    await this.closeNewcomers();
    this.count('newcomers');
  }

  /** P10c/P10d: generate in the fresh fan's card, then one real send click and durable custody/row confirmation. */
  async greeting(): Promise<Chat> {
    const fan = String(930_000_000_000_000_000n + BigInt(++this.sequence));
    await fakeFansly().command({ op: 'follow', followerId: fan, silent: true });
    const created = await fakeFansly().command({ op: 'conversation', fanId: fan });
    if (created.groupId === undefined) throw new Error('no greeting group');
    const chat = { group: created.groupId, fan };
    await this.hub.command({ op: 'thread', pageLabel: WORLD.pages.fansly.pageLabel, conversationRef: chat.group, fanRef: fan });
    await this.hub.command({ op: 'archiveConversation', pageLabel: WORLD.pages.fansly.pageLabel, conversationRef: chat.group, messages: [] });
    const text = `Hello from the synthetic long run ${this.sequence}.`;
    await this.hub.command({ op: 'config', patch: { aiTexts: { 'hi-greeting': text } } });
    await this.openNewcomers();
    await pressOurs('modal', '.cg-fnw [role="tab"]', /^Все \d+$/);
    const row = `.cg-fnw__row[data-cg-fan$=":${fan}"]`;
    const card = '.cg-fnc';
    const field = `${card} .cg-fnc__greet textarea`;
    const buttons = `${card} .cg-fnc__gbar button`;
    const check = () => readOurs('modal', row, (node) => node.getAttribute('data-cg-check'));
    await browser.waitUntil(async () => (await check()) === 'ready', { timeout: 90_000, timeoutMsg: 'the new follower was not checked ready' });
    await ours('modal', row).click();
    await pressOurs('modal', buttons, 'Сгенерировать');
    await browser.waitUntil(async () => (await readOurs('modal', field, (node) => (node as HTMLTextAreaElement).value)) === text && await oursExists('modal', `${card} .cg-fnc__ai`), { timeout: 30_000, timeoutMsg: 'no AI greeting in the newcomer card' });
    this.expectSend();
    await pressOurs('modal', buttons, 'Отправить →');
    await browser.waitUntil(async () => {
      const claim = (await this.hub.status()).claims.find((claim) => claim.pageLabel === WORLD.pages.fansly.pageLabel && claim.fanRef === fan);
      return claim?.greeting === 'confirmed' && claim.attempts.length === 1 && claim.attempts[0]?.state === 'sent';
    }, { timeout: 35_000, timeoutMsg: 'greeting custody did not confirm exactly one send' });
    await browser.waitUntil(async () => (await check()) === 'greeted', { timeout: 10_000, timeoutMsg: 'the newcomer was not marked greeted' });
    await this.closeNewcomers();
    await this.open(chat);
    await browser.waitUntil(async () => (await browser.$(FANSLY_MAIN.list).getText()).includes(text), { timeout: 15_000, timeoutMsg: 'the native chat did not show the greeting text' });
    this.count('greeting');
    return chat;
  }

  /** Until P11b's panel lands: native notes CRUD through the existing TEST API probe, real FS-NET-1/pacer. */
  async notes(chat: Chat): Promise<void> {
    const call = async <T>(route: string, fields: Record<string, unknown>): Promise<T> => {
      const id = `long-note-${++this.sequence}`;
      await this.shift.toPages();
      await writeLocalStorage({ 'dev.fanslyApi.call': { id, account: WORLD.pages.fansly.platformAccountId, purpose: 'notes', route, readNotesResponse: true, ...fields } });
      let response: T | undefined;
      await browser.waitUntil(async () => {
        const result = (await readLocalStorage(['dev.fanslyApi.result']))['dev.fanslyApi.result'] as { id: string; ok: boolean; response?: T } | undefined;
        if (result?.id !== id) return false;
        if (!result.ok) throw new Error(`notes API ${route}: ${JSON.stringify(result)}`);
        response = result.response;
        return true;
      }, { timeout: 30_000, timeoutMsg: `notes API ${route} stuck` });
      return response as T;
    };
    const body = { contentType: 12000, contentId: chat.fan, title: 'Long run', note: 'Synthetic note' };
    const note = await call<{ id: string }>('notes.create', { body });
    expect(note.id).toMatch(/^\d+$/);
    await call('notes.edit', { body: { ...body, id: note.id, note: 'Edited synthetic note' } });
    const read = (): Promise<Array<{ notes: Array<{ id: string; note: string }> }>> => call('account.byIds', { query: { ids: chat.fan } });
    expect((await read())[0]?.notes).toContainEqual(expect.objectContaining({ id: note.id, note: 'Edited synthetic note' }));
    await call('notes.delete', { body: { ...body, id: note.id } });
    expect((await read())[0]?.notes.some((item) => item.id === note.id)).toBe(false);
    await this.shift.toFansly();
    this.count('notes');
  }

  /** The real vault panel hands two files to the page, one at a time; page POSTs and card read-back prove completion. */
  async vault(): Promise<void> {
    await this.shift.toFansly();
    await openFanslyStand('/creator/vault');
    const panel = async (predicate: (value: { run?: { state: string; done: number }; controls?: { blocked: string | null }; album?: { state: string } }) => boolean) =>
      waitForReport((report) => report['vault'] !== undefined && predicate(report['vault'] as Parameters<typeof predicate>[0]), 'vault panel', 60_000);
    await browser.waitUntil(() => oursExists('panel', '[data-cg-vault-entry]'), { timeout: 20_000 });
    await ours('panel', '[data-cg-vault-entry]').click();
    await browser.$('app-media-vault-route .vault-album').waitForExist({ timeout: 10_000 });
    await browser.$('app-media-vault-route .vault-album').click();
    await browser.$('app-media-vault-route .vault-header').waitForExist({ timeout: 5000 });
    await browser.$('app-media-vault-route .close-toggle').click();
    await ours('panel', '.cg-vault__card').moveTo();
    await panel((value) => value.album?.state === 'open');
    const names = [1, 2].map((index) => `long-${++this.sequence}-${index}.jpg`);
    const paths = names.map((name) => { const path = `${this.evidenceDir}/${name}`; writeFileSync(path, Buffer.alloc(64)); return path; });
    await ours('panel', 'input[data-cg-vault-input="files"]').addValue(paths.join('\n'));
    await panel((value) => value.controls?.blocked === null);
    await ours('panel', '[data-cg-vault-start]').click();
    await panel((value) => value.run?.state === 'complete' && value.run.done === 2);
    const cards = await browser.$$('app-media-vault-route .image-filename').map((element) => element.getText());
    for (const name of names) expect(cards).toContain(name);
    this.count('vault');
  }
}
