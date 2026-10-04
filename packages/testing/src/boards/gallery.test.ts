// The boards' stand: its build, its states and its data. Every action a state
// carries must be a valid UiAction (the UI dispatches them unchanged), every
// id synthetic, and the gallery must cover every drawn state of the mockup
// (ui-design §0.2: 11 a–j, 13 a–d, 14 a–c, 15 a–b).

import { describe, expect, it } from 'vitest';

import { LOCALES, PREVIEW_SEND_STATES, UI_ACTION_TYPES, UiActionSchema, ViewSelectorSchema, type PreviewVM, type UiActionType } from '@cg/contracts';

import viteConfig, { BOARDS_GALLERY_BASE, BOARDS_GALLERY_BUILD_DIR as VITE_OUT_DIR, BOARDS_GALLERY_SOURCE_DIR as VITE_ROOT } from '../../boards-gallery.vite.config';
import { ctxOf } from '../scenarios/app-client';
import { BOARDS_GALLERY_BUILD_DIR, BOARDS_GALLERY_PATH, BOARDS_GALLERY_SOURCE_DIR, GALLERIES } from '../stand/paths';
import { BOARD_FANS, SHELF_BOUNDS, boardShelves, boardStats, manyFans } from './data';
import { BOARD_SURFACES } from './harness';
import { BOARD_STATES, boardScenario } from './states';

const MOCKUP_STATES = ['11a', '11b', '11c', '11d', '11e', '11f', '11g', '11h', '11i', '11j', '13a', '13b', '13c', '13d', '14a', '14b', '14c', '15a', '15b'];

function walk(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) for (const item of value) walk(item, visit);
  else if (value !== null && typeof value === 'object') {
    visit(value as Record<string, unknown>);
    for (const child of Object.values(value)) walk(child, visit);
  }
}

const isActionType = (value: unknown): value is UiActionType => typeof value === 'string' && (UI_ACTION_TYPES as readonly string[]).includes(value);

describe('the boards gallery build', () => {
  it('builds from src/boards/gallery into .cache/boards-gallery and is served at /boards-gallery/', () => {
    expect(VITE_ROOT).toBe(BOARDS_GALLERY_SOURCE_DIR);
    expect(VITE_OUT_DIR).toBe(BOARDS_GALLERY_BUILD_DIR);
    expect(BOARDS_GALLERY_BUILD_DIR).toMatch(/\/\.cache\/boards-gallery\/$/);
    expect(BOARDS_GALLERY_BASE).toBe(BOARDS_GALLERY_PATH);
    expect(viteConfig).toMatchObject({ root: BOARDS_GALLERY_SOURCE_DIR, base: BOARDS_GALLERY_PATH, build: { outDir: BOARDS_GALLERY_BUILD_DIR } });
    // The stand serves what its gallery registry lists.
    expect(GALLERIES[BOARDS_GALLERY_PATH]).toBe(BOARDS_GALLERY_BUILD_DIR);
  });
});

describe('the boards gallery states', () => {
  it('cover every drawn state of the mockup for Spenders, «Новые», the fan panel and the palette', () => {
    const ids = BOARD_STATES.map((state) => state.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of MOCKUP_STATES) expect(ids, id).toContain(id);
    for (const state of BOARD_STATES) expect(Object.keys(BOARD_SURFACES), state.id).toContain(state.surface);
  });

  it('every selector and every action a state carries is valid in both languages', () => {
    for (const language of LOCALES) {
      for (const state of BOARD_STATES) {
        const scenario = boardScenario(state.id, language);
        for (const view of scenario.views) {
          expect(ViewSelectorSchema.safeParse(view.selector).success, `${state.id} selector`).toBe(true);
          walk(view.vm, (node) => {
            if (!isActionType(node['type'])) return;
            const parsed = UiActionSchema.safeParse(node);
            expect(parsed.success, `${state.id} ${language}: ${JSON.stringify(node)}`).toBe(true);
          });
        }
      }
    }
  });

  it('[SP-054] the «Отправить» gallery shows all nine states, with both kinds of refusal', () => {
    const preview = boardScenario('11h').views.find((view) => view.selector.of === 'preview')?.vm as PreviewVM;
    const states = (preview.result?.parts ?? []).map((part) => part.send);
    expect(new Set(states.map((send) => send?.s))).toEqual(new Set(PREVIEW_SEND_STATES));
    expect(states.filter((send) => send?.s === 'rejected').map((send) => (send?.s === 'rejected' ? send.canRetry : null))).toEqual([false, true]);
  });

  it('no state sends, inserts or generates by itself: a state holds no «send all» action and no pending send', () => {
    for (const state of BOARD_STATES) {
      const types: string[] = [];
      walk(boardScenario(state.id).views, (node) => {
        if (isActionType(node['type'])) types.push(node['type']);
      });
      // «Отправить» is built by the UI from the part's own numbers on a click; a model never carries a ready SendPart.
      expect(types.filter((type) => type === 'SendPart' || type === 'InsertPart'), state.id).toEqual([]);
    }
  });
});

describe('the boards dataset', () => {
  const ctx = ctxOf({ lang: 'ru', platform: 'mac' });

  it('is synthetic: our own handles, no numeric id of an account or a fan', () => {
    for (const fan of [...BOARD_FANS, ...manyFans(50)]) {
      expect(fan.key).toMatch(/^b\d{3,4}$/);
      expect(fan.username).not.toMatch(/^\d+$/);
    }
    const text = JSON.stringify(BOARD_STATES.map((state) => boardScenario(state.id).views));
    expect(text.match(/"\d{5,}"/g) ?? []).toEqual([]);
  });

  it('forty fans over six shelves, with the sums the mockup shows', () => {
    const shelves = boardShelves(ctx, BOARD_FANS, null);
    expect(shelves.map((shelf) => [shelf.fans, (shelf.lifetime ?? 0) / 1000, (shelf.period ?? 0) / 1000])).toEqual([
      [8, 78_690, 4_005],
      [6, 2_807, 200],
      [7, 1_705, 310],
      [7, 631, 105],
      [6, 224, 40],
      [6, 82, 10],
    ]);
    expect(shelves).toHaveLength(SHELF_BOUNDS.length);
    expect(BOARD_FANS).toHaveLength(40);
  });

  it('the statistics agree with the board: 30 days, 7 days against the 7 before, payers, the average check', () => {
    const stats = boardStats(ctx, BOARD_FANS);
    expect((stats.d30.mills ?? 0) / 1000).toBe(4_670);
    expect(stats.days).toHaveLength(30);
    expect(stats.days.reduce((sum, day) => sum + (day.gross ?? 0), 0)).toBe(stats.d30.mills);
    expect(stats.days.filter((day) => day.today)).toHaveLength(1);
    expect(stats.payers.count).toBe(20);
    expect(stats.d30.purchases).toBe(44);
    expect(stats.attention.awaiting.count).toBe(12);
    expect(stats.attention.newPayers.count).toBe(3);
    expect(Math.round(stats.d7.changePct ?? 0)).toBe(4);
  });

  it('a thousand fans fill every shelf', () => {
    const shelves = boardShelves(ctx, manyFans(1000), null);
    expect(shelves.reduce((sum, shelf) => sum + shelf.rows.length, 0)).toBe(1000);
    expect(shelves.every((shelf) => shelf.rows.length > 0)).toBe(true);
  });
});
