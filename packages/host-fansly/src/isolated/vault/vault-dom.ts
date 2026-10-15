/** Fansly rewrites JPG to jpeg; preserve the legacy extension-less, NFC, case-insensitive match. */
export const vaultMediaKey = (name: string): string => name.normalize('NFC').trim().replace(/\.(jpg|jpeg|png|gif|webp|mp4|mov|m4v|webm)$/i, '').trim().toLowerCase();

/** Live anchors from the legacy vault and research/fansly.md; no Angular internals. */
export interface VaultView {
  root: Element;
  title: string | null;
  input: HTMLInputElement | null;
  busy: boolean;
  error: string | null;
  text: string;
  cards: readonly { name: string; ready: boolean }[];
}
const processing = /Verifying|Processing|Uploading|\d+(?:\.\d+)?%/i;
const failure = /Failed|Error|Retry/i;
const text = (el: Element): string => (el as HTMLElement).innerText ?? el.textContent ?? '';
export function readVaultView(doc: Document): VaultView | null {
  const roots = doc.querySelectorAll('app-media-vault');
  const root = roots.length === 1 ? roots[0] : null;
  if (!root) return null;
  let title: string | null = null;
  for (const node of root.childNodes) {
    const line = (node.nodeType === 1 ? text(node as Element) : node.textContent ?? '').split('\n').find((s) => s.trim() !== '');
    if (line !== undefined) { title = line.trim(); break; }
  }
  const uploader = root.querySelector('app-media-upload-input');
  const inputs = uploader?.querySelectorAll<HTMLInputElement>('input[type="file"]');
  const line = uploader ? text(uploader).trim() : '';
  return {
    root, title, input: inputs?.length === 1 ? inputs[0] ?? null : null,
    busy: Boolean(uploader?.querySelector('.media-container:not(.add-more)')) || processing.test(line),
    error: failure.test(line) ? line.slice(0, 300) : null, text: line,
    cards: [...root.querySelectorAll('.vault-row')].map((row) => ({ name: row.querySelector('.image-filename')?.textContent?.trim() ?? '', ready: !processing.test(text(row)) && !failure.test(text(row)) })),
  };
}
/** Observes only during a run; no idle poll or permanent card-list observer. */
export function watchVault(doc: Document, changed: () => void): () => void {
  const root = readVaultView(doc)?.root;
  if (!root) return () => undefined;
  const observer = new MutationObserver(changed);
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
  if (root.parentElement) observer.observe(root.parentElement, { childList: true });
  return () => observer.disconnect();
}
/** Exactly one file, exactly one change. A failed dispatch is indeterminate, never retried. */
export function handoffFile(input: HTMLInputElement, file: File): 'passed' | 'unavailable' | 'unknown' {
  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
  } catch { return 'unavailable'; }
  try {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return 'passed';
  } catch { return 'unknown'; }
}
