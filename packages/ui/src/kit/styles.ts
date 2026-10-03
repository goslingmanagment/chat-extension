// Styles go into our shadow roots (and extension pages) as constructable
// stylesheets (adoptedStyleSheets, architecture.md §6.3): no global CSS, no
// <style> in ChatSpace's DOM. One CSSStyleSheet per source and document is
// shared by every root that adopts it, so ten roots cost one parse (EX-012).
// If the browser refuses (a Firefox content-script Xray quirk), the root gets
// a <style> element of its own instead.

export type StyleMode = 'adopted' | 'style-element';

/** A named piece of CSS; the id keys the shared sheet. */
export interface StyleSource {
  readonly id: string;
  readonly css: string;
}

type StyleRoot = ShadowRoot | Document;

interface CachedSheet {
  readonly css: string;
  readonly sheet: CSSStyleSheet;
}

const sheetsByDocument = new WeakMap<Document, Map<string, CachedSheet>>();

function documentOf(root: StyleRoot): Document {
  return 'ownerDocument' in root && root.ownerDocument !== null ? root.ownerDocument : root;
}

/** The shared sheet of `source` for the document `root` lives in; built once per document and id. */
export function sharedSheet(root: StyleRoot, source: StyleSource): CSSStyleSheet {
  const document = documentOf(root);
  let sheets = sheetsByDocument.get(document);
  if (sheets === undefined) {
    sheets = new Map();
    sheetsByDocument.set(document, sheets);
  }
  const cached = sheets.get(source.id);
  if (cached !== undefined && cached.css === source.css) return cached.sheet;
  const sheet = cached?.sheet ?? new CSSStyleSheet();
  sheet.replaceSync(source.css);
  sheets.set(source.id, { css: source.css, sheet });
  return sheet;
}

function appendStyleElements(root: StyleRoot, sources: readonly StyleSource[]): void {
  const document = documentOf(root);
  const parent: ParentNode = 'head' in root ? (root.head ?? root.documentElement) : root;
  for (const source of sources) {
    const existing = [...parent.querySelectorAll('style[data-cg-style]')].find((node) => node.getAttribute('data-cg-style') === source.id);
    if (existing !== undefined) {
      existing.textContent = source.css;
      continue;
    }
    const style = document.createElement('style');
    style.setAttribute('data-cg-style', source.id);
    style.textContent = source.css;
    parent.append(style);
  }
}

/**
 * Adopts `sources` into `root` in order, after what the root already has and
 * without duplicates (the same shared sheet is never adopted twice).
 */
export function adoptSheets(root: StyleRoot, sources: readonly StyleSource[]): StyleMode {
  try {
    const sheets = sources.map((source) => sharedSheet(root, source));
    const current = [...root.adoptedStyleSheets];
    root.adoptedStyleSheets = [...current, ...sheets.filter((sheet) => !current.includes(sheet))];
    return 'adopted';
  } catch {
    appendStyleElements(root, sources);
    return 'style-element';
  }
}

/** A short content hash (djb2): the same CSS text is the same shared sheet. */
function hashOf(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  return hash.toString(36);
}

/** R00 helper kept for the placeholder dock and the spike: one source keyed by its content. */
export function adoptStyles(root: ShadowRoot, cssText: string): StyleMode {
  return adoptSheets(root, [{ id: `css-${hashOf(cssText)}-${cssText.length}`, css: cssText }]);
}
