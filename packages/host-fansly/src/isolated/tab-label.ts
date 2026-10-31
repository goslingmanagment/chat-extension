// The page's label on the browser's tab (2026-10-31; Grisha: «иногда hi в уведомлении переключает на вторую вкладку с
// другой страницей … я теряюсь»): a chatter works several pages of one model, and every Fansly tab has the same title.
// The tab of a page bound in the hub reads «lora-2 · Fansly», so the tab a reminder's «Hi» brings forward is told by its
// name in the browser's own strip. Fansly writes its title again on a route (`document.title`): the label goes back in
// front of whatever it wrote, and leaves with the port. A title the label already leads is left alone.

/** Between the label and Fansly's own title. */
export const TAB_LABEL_SEPARATOR = ' · ';

export interface TabLabel {
  /** The page's hub label; null — none (the title is Fansly's own again). */
  set(label: string | null): void;
  dispose(): void;
}

export function createTabLabel(doc: Document): TabLabel {
  let label: string | null = null;
  let observer: MutationObserver | null = null;
  const lead = (of: string): string => `${of}${TAB_LABEL_SEPARATOR}`;
  const without = (title: string, of: string | null): string => (of !== null && title.startsWith(lead(of)) ? title.slice(lead(of).length) : title);
  const apply = (): void => {
    if (label !== null && !doc.title.startsWith(lead(label))) doc.title = `${lead(label)}${doc.title}`;
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
