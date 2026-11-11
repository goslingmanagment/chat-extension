// The page's label on the browser's tab (2026-10-31; Grisha: «иногда hi в уведомлении переключает на вторую вкладку с
// другой страницей … я теряюсь»): a chatter works several pages of one model, and every Fansly tab has the same title.
// The tab of a page bound in the hub reads «lora-2 · Fansly», so the tab a reminder's «Hi» brings forward is told by its
// name in the browser's own strip. Fansly writes its title again on a route (`document.title`): the label goes back in
// front of whatever it wrote, and leaves with the port. A title the label already leads is left alone.
//
// An unread counter stays in front of the label: «(25) lora-2 · Fansly» (2026-11-12). FBuddy rewrites the title every
// 10 s as `(N) <title>` and takes its old counter off the START only (`/^\(\d+\+?\)\s*/`). With the label ahead of the
// counter it never found one, so every round added a counter and we added a label: «ari-1 · (25) ari-1 · (30) ari-1 …».
// The label now goes after a leading counter, and a title an earlier build left that way is folded back to one label.

/** Between the label and Fansly's own title. */
export const TAB_LABEL_SEPARATOR = ' · ';

/** An unread counter at the start of a title, as FBuddy writes it: «(25) », «(99+) ». */
const COUNTER = /^\(\d+\+?\)\s*/;

export interface TabLabel {
  /** The page's hub label; null — none (the title is Fansly's own again). */
  set(label: string | null): void;
  dispose(): void;
}

export function createTabLabel(doc: Document): TabLabel {
  let label: string | null = null;
  let observer: MutationObserver | null = null;
  const lead = (of: string): string => `${of}${TAB_LABEL_SEPARATOR}`;
  /** The title's leading counter and the title under it, with every `of` label in front (and a counter caught between two) taken off. */
  const split = (title: string, of: string | null): { counter: string; own: string } => {
    const counter = COUNTER.exec(title)?.[0] ?? '';
    let own = title.slice(counter.length);
    if (of === null) return { counter, own };
    for (;;) {
      const caught = COUNTER.exec(own)?.[0].length ?? 0;
      if (!own.startsWith(lead(of), caught)) return { counter, own };
      own = own.slice(caught + lead(of).length);
    }
  };
  const without = (title: string, of: string | null): string => {
    const { counter, own } = split(title, of);
    return `${counter}${own}`;
  };
  const apply = (): void => {
    if (label === null) return;
    const { counter, own } = split(doc.title, label);
    const labelled = `${counter}${lead(label)}${own}`;
    if (doc.title !== labelled) doc.title = labelled;
  };
  const stop = (): void => {
    observer?.disconnect();
    observer = null;
  };
  return {
    set(next) {
      if (next === label) return;
      const before = label;
      label = next;
      doc.title = without(doc.title, before);
      if (label === null) {
        stop();
        return;
      }
      apply();
      if (observer !== null || typeof MutationObserver === 'undefined') return;
      // The <title> element's text, or a new <title>: our own write comes back here and changes nothing more.
      observer = new MutationObserver(apply);
      observer.observe(doc.head ?? doc.documentElement, { childList: true, subtree: true, characterData: true });
    },
    dispose() {
      stop();
      doc.title = without(doc.title, label);
      label = null;
    },
  };
}
