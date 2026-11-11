// The tab's label next to a neighbour's unread counter (2026-11-12, the owner's tab: «ari-1 · (25) ari-1 · (30) ari-1 ·
// (26) …»): FBuddy rewrites the title every 10 s and takes its old counter off the start of the title only, so a label
// ahead of the counter grew the title by a label and a counter each round.

import { afterEach, describe, expect, it } from 'vitest';

import { createTabLabel, type TabLabel } from './tab-label';

/** FBuddy's 10-s refresh, as its content script does it (`updateFaviconAndTitle`, 2026.927.830). */
function neighbourRefresh(unread: number): void {
  const base = document.title.replace(/^\(\d+\+?\)\s*/, '');
  const counted = unread > 0 ? `(${unread >= 99 ? '99+' : String(unread)}) ${base}` : base;
  document.title = `${counted} FB`;
  document.title = counted;
}

/** The label's observer has seen the writes. */
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

let label: TabLabel | null = null;
function labelled(title: string, as: string): TabLabel {
  document.title = title;
  label = createTabLabel(document);
  label.set(as);
  return label;
}
afterEach(() => {
  label?.dispose();
  label = null;
});

describe('the tab label and an unread counter', () => {
  it('stays one label after one counter through the refreshes', async () => {
    labelled('Fansly', 'ari-1');
    expect(document.title).toBe('ari-1 · Fansly');
    for (const unread of [25, 30, 26, 26, 120]) {
      neighbourRefresh(unread);
      await settled();
      expect(document.title).toBe(`(${unread >= 99 ? '99+' : String(unread)}) ari-1 · Fansly`);
    }
    neighbourRefresh(0);
    await settled();
    expect(document.title).toBe('ari-1 · Fansly');
  });

  it("goes back onto Fansly's fresh title, and the next counter lands in front of it", async () => {
    labelled('Fansly', 'ari-1');
    neighbourRefresh(25);
    await settled();
    document.title = 'Messages | Fansly';
    await settled();
    expect(document.title).toBe('ari-1 · Messages | Fansly');
    neighbourRefresh(26);
    await settled();
    expect(document.title).toBe('(26) ari-1 · Messages | Fansly');
  });

  it('folds a title an earlier build piled up', () => {
    labelled('ari-1 · (25) ari-1 · (30) ari-1 · Fansly', 'ari-1');
    expect(document.title).toBe('ari-1 · Fansly');
    label?.dispose();
    labelled('(31) ari-1 · (25) ari-1 · (30) ari-1 · Fansly', 'ari-1');
    expect(document.title).toBe('(31) ari-1 · Fansly');
  });

  it('leaves the counter where it is when the label changes or goes', () => {
    const tab = labelled('(25) Fansly', 'ari-1');
    expect(document.title).toBe('(25) ari-1 · Fansly');
    tab.set('ari-2');
    expect(document.title).toBe('(25) ari-2 · Fansly');
    tab.set(null);
    expect(document.title).toBe('(25) Fansly');
  });
});
