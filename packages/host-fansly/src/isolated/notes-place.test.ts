import { describe, expect, it } from 'vitest';

import { NOTES_DOCK_MIN_FREE_PX, notesFit, placeNotes } from './notes-place';

const viewport = { width: 1600, height: 900 };

describe('«Заметки»: where the panel stands (R20 P11b)', () => {
  it('[FX-009] [FS-NOTE-2] beside the chat in Fansly’s free column when it holds the panel, over the chat’s right edge otherwise — under its header, above the composer', () => {
    const wide = { top: 64, right: 1200, width: 900 };
    expect(notesFit(wide, viewport)).toBe(true);
    expect(placeNotes(wide, 780, viewport)).toEqual({ kind: 'docked', top: 64, bottom: 12, left: 1212, width: 376 });
    const narrow = { top: 64, right: viewport.width - NOTES_DOCK_MIN_FREE_PX + 1, width: 900 };
    expect(notesFit(narrow, viewport)).toBe(false);
    expect(placeNotes(narrow, 780, viewport)).toEqual({ kind: 'over', top: 120, bottom: 128, left: narrow.right - 10 - 360, width: 360 });
    // A low window: the panel would be a sliver above the composer — it covers the composer instead.
    expect(placeNotes(narrow, 300, { width: 1600, height: 400 }).bottom).toBe(12);
    expect(placeNotes(null, null, viewport)).toMatchObject({ kind: 'over', top: 80 });
  });
});
