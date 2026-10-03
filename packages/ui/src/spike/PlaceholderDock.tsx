// Placeholder dock of the M0 spike (architecture.md §3, §6.3): a toolbar row
// with a status and an input above the ChatSpace composer. It only proves the
// mount, focus and typing inside a closed shadow root; the composition root
// and the spike e2e still use it. The real dock is `@cg/ui/dock` (R14): once
// the tab composition mounts that one, this file and its mount go away.

import { useState } from 'preact/hooks';

export interface DockModel {
  /** Short human-readable status line, already localized. */
  readonly status: string;
}

export function Dock({ model }: { model: DockModel }) {
  const [note, setNote] = useState('');
  return (
    <div class="cg-dock" role="toolbar" aria-label="ChatGoose">
      <span class="cg-dock__brand">ChatGoose</span>
      <span class="cg-dock__status" data-cg-status>
        {model.status}
      </span>
      <input
        class="cg-dock__input"
        value={note}
        placeholder="Заметка"
        onInput={(event) => setNote(event.currentTarget.value)}
      />
    </div>
  );
}

export const DOCK_CSS = `
.cg-dock {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 10px;
  box-sizing: border-box;
  border: 1px solid var(--cg-border);
  border-radius: var(--cg-radius);
  background: var(--cg-bg);
  font-size: 13px;
}
.cg-dock__brand { font-weight: 600; }
.cg-dock__status { color: var(--cg-muted); flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cg-dock__input { width: 160px; height: 24px; font: inherit; padding: 0 6px; border: 1px solid var(--cg-border); border-radius: 6px; }
.cg-dock__input:focus { outline: 2px solid var(--cg-accent); outline-offset: 0; }
`;
