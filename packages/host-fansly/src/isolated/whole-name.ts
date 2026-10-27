// The fan's whole name in Fansly's chat header (2026-10-26). Fansly's `app-account-username` cuts the display name at
// `maxLength` — 10 in the chat header («Chet/Austr...») — while the page's account answers hold it whole; MAIN gives it
// with the chat (`fx.chat.fanCustomName` — the creator's custom name for the fan, which Fansly shows first — else
// `fanDisplayName`, else `fanUsername`: Fansly's `getDisplayName`). Only Fansly's own cut is replaced: a text that is the whole name's first
// characters and «...». Another fan's name, or a name Fansly shows whole, is never touched.
//
// Angular writes the text again only when its own value changes, and re-creates the block on a chat switch: one
// observer, `childList + subtree + characterData` on that `app-account-username` alone, puts the whole name back. Its
// tooltips and the notes menu are the only other things there; the sub-row with the typing line and our slots is not
// under it. Off (no name known, no header), the observer stands nowhere. On dispose Fansly's own text comes back.

const SUFFIX = '...';

/** The cut Fansly made of `whole` — its first characters and «...» — and the whole name in its place; null — not a cut of it. */
export function wholeNameFor(shown: string, whole: string): string | null {
  const trimmed = shown.trim();
  if (!trimmed.endsWith(SUFFIX)) return null;
  const kept = trimmed.slice(0, -SUFFIX.length);
  if (kept === '' || kept.length >= whole.length || !whole.startsWith(kept)) return null;
  const at = shown.indexOf(trimmed);
  return shown.slice(0, at) + whole + shown.slice(at + trimmed.length);
}

export function createWholeName(nameSelector: string) {
  let target: Element | null = null;
  let whole: string | null = null;
  /** Our last write: Fansly's text before it, given back on dispose. */
  let written: { node: Text; mine: string; theirs: string } | null = null;
  const apply = (): void => {
    if (target === null || whole === null) return;
    const span = target.querySelector(nameSelector);
    const node = span === null ? null : [...span.childNodes].find((child): child is Text => child.nodeType === 3 && (child as Text).data.trim() !== '');
    if (node === undefined || node === null) return;
    const next = wholeNameFor(node.data, whole);
    // Already whole (a name that itself ends in «...»): a write of the same text would wake the observer again.
    if (next === null || next === node.data) return;
    written = { node, mine: next, theirs: node.data };
    node.data = next;
  };
  const observer = new MutationObserver(apply);
  return {
    /** The open direct chat's `app-account-username` and its fan's whole name; nulls — nothing to show. */
    sync(next: Element | null, name: string | null): void {
      const nextName = next === null ? null : name;
      if (next !== target || (nextName === null) !== (whole === null)) {
        observer.disconnect();
        if (next !== null && nextName !== null) observer.observe(next, { childList: true, subtree: true, characterData: true });
      }
      target = next;
      whole = nextName;
      apply();
    },
    dispose(): void {
      observer.disconnect();
      if (written !== null && written.node.isConnected && written.node.data === written.mine) written.node.data = written.theirs;
      written = null;
      target = null;
      whole = null;
    },
  };
}

export type WholeName = ReturnType<typeof createWholeName>;
